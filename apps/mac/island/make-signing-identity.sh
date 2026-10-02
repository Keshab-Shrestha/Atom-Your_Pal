#!/bin/sh
# Creates "ZENO Local Signing", a self-signed code-signing certificate (ADR-040), in its own keychain.
#
#   apps/mac/island/make-signing-identity.sh
#
# macOS ties permissions (Input Monitoring, Accessibility, Microphone) to an app's signature. An ad hoc
# signature changes with every build, so permissions would be asked for again after each rebuild. Signed
# with this certificate, ZENO keeps them. Run once per Mac; build-app.sh uses it when it exists.
#
# The certificate lives in ~/Library/Keychains/zeno-signing.keychain-db, not the login keychain: in the
# login keychain, codesign must be approved with your password on every build. This keychain's password
# is random, kept in ~/.config/zeno/signing-keychain-password (readable only by you), and unlocks only
# this keychain. The certificate is trusted nowhere and is useful only for signing ZENO on this Mac.
set -eu

name="ZENO Local Signing"
keychain="$HOME/Library/Keychains/zeno-signing.keychain-db"
secret_dir="$HOME/.config/zeno"
secret="$secret_dir/signing-keychain-password"

if [ -f "$keychain" ] && [ -f "$secret" ] && security find-certificate -c "$name" "$keychain" >/dev/null 2>&1; then
  echo "\"$name\" already exists."
  exit 0
fi

mkdir -p "$secret_dir"
chmod 700 "$secret_dir"
rm -f "$keychain"
(umask 077 && openssl rand -hex 24 > "$secret")
password=$(cat "$secret")

security create-keychain -p "$password" "$keychain"
security set-keychain-settings "$keychain" # no auto-lock timeout; build-app.sh unlocks it anyway
security unlock-keychain -p "$password" "$keychain"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cat > "$work/cert.conf" <<CONF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $name
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
CONF

openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$work/cert.conf" \
  -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
# PKCS#12 import needs a password; a one-time random one, and the file is deleted on exit.
p12pass=$(openssl rand -hex 16)
openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" -name "$name" \
  -out "$work/identity.p12" -passout "pass:$p12pass" 2>/dev/null
security import "$work/identity.p12" -k "$keychain" -P "$p12pass" -T /usr/bin/codesign >/dev/null
# Let Apple's tools (codesign) use the key without a prompt. Needs this keychain's password, which we have.
security set-key-partition-list -S apple-tool:,apple: -s -k "$password" "$keychain" >/dev/null

# Add to the search list so codesign finds it, keeping the existing keychains.
existing=$(security list-keychains -d user | sed 's/^ *"//; s/"$//')
# shellcheck disable=SC2086
security list-keychains -d user -s $existing "$keychain"

echo "Created \"$name\" in $keychain."
