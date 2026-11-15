"""Encryption for the Deal Desk inventory map.

How the lock works (think of a lockbox on a listing):
- vault.json holds a PUBLIC key (the slot anyone can drop mail into) and the
  matching PRIVATE key, itself locked with the owner's passphrase.
- data.enc is the property data, sealed with the public key. Any Claude session
  can seal fresh data without knowing the passphrase.
- The map page asks for the passphrase, unlocks the private key in the browser,
  and opens data.enc. Nothing readable is ever published.

Commands:
  python tools/mapcrypt.py init                # create vault.json (asks for a passphrase)
  python tools/mapcrypt.py seal listings.json  # write data.enc from a Deal Desk listings export
  python tools/mapcrypt.py repass              # change the passphrase (asks for old and new)

listings.json is the Deal Desk "listings" collection: {"records": [ {...}, ... ]} or a plain list.
Never commit the plain listings file to this repo; it is public.
"""
import base64
import getpass
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = Path(__file__).resolve().parent.parent
VAULT = ROOT / 'vault.json'
DATA = ROOT / 'data.enc'
ITER = 310000
b64 = lambda b: base64.b64encode(b).decode()
unb64 = base64.b64decode
OAEP = padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)


def _kek(passphrase, salt, iterations=ITER):
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations).derive(passphrase.encode())


def _wrap_private(priv_der, passphrase):
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(_kek(passphrase, salt)).encrypt(iv, priv_der, None)
    return {'kdf': 'PBKDF2-SHA256', 'iter': ITER, 'salt': b64(salt), 'iv': b64(iv), 'ct': b64(ct)}


def _unwrap_private(w, passphrase):
    der = AESGCM(_kek(passphrase, unb64(w['salt']), w['iter'])).decrypt(unb64(w['iv']), unb64(w['ct']), None)
    return serialization.load_der_private_key(der, password=None)


def _ask(prompt):
    return os.environ.get('MAP_PASSPHRASE') or getpass.getpass(prompt)


def init(passphrase=None):
    if VAULT.exists():
        sys.exit('vault.json already exists; use repass to change the passphrase.')
    passphrase = passphrase or _ask('New passphrase: ')
    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    der = key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    pub = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    VAULT.write_text(json.dumps({'v': 1, 'alg': 'RSA-OAEP-256 + AES-256-GCM', 'publicKey': b64(pub),
                                 'privateKey': _wrap_private(der, passphrase)}, indent=1) + '\n')
    print('vault.json created')


def seal(path):
    vault = json.loads(VAULT.read_text())
    pub = serialization.load_der_public_key(unb64(vault['publicKey']))
    src = json.loads(Path(path).read_text())
    records = src.get('records', []) if isinstance(src, dict) else src
    payload = {'sealedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
               'snapshotAt': src.get('exportedAt') if isinstance(src, dict) else None,
               'listings': records}
    dek, iv = AESGCM.generate_key(bit_length=256), os.urandom(12)
    ct = AESGCM(dek).encrypt(iv, json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode(), None)
    DATA.write_text(json.dumps({'v': 2, 'key': b64(pub.encrypt(dek, OAEP)), 'iv': b64(iv), 'ct': b64(ct)}) + '\n')
    print(f'data.enc sealed: {len(records)} listings')


def repass():
    vault = json.loads(VAULT.read_text())
    key = _unwrap_private(vault['privateKey'], getpass.getpass('Current passphrase: '))
    new = getpass.getpass('New passphrase: ')
    der = key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    vault['privateKey'] = _wrap_private(der, new)
    VAULT.write_text(json.dumps(vault, indent=1) + '\n')
    print('Passphrase changed. Old passphrase no longer opens the map.')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'init':
        init()
    elif cmd == 'seal' and len(sys.argv) > 2:
        seal(sys.argv[2])
    elif cmd == 'repass':
        repass()
    else:
        sys.exit(__doc__)
