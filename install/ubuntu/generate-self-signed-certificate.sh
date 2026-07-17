#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "This installer helper must run as root." >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "OpenSSL is required to create Chroma's initial certificate." >&2
  exit 1
fi

CHROMA_USER="${CHROMA_USER:-chroma}"
CHROMA_GROUP="${CHROMA_GROUP:-chroma}"
PKI_DIR="${CHROMA_PKI_DIR:-/etc/chroma/pki}"
KEY_PATH="${CHROMA_TLS_KEY_PATH:-${PKI_DIR}/private.key}"
CERTIFICATE_PATH="${CHROMA_TLS_CERT_PATH:-${PKI_DIR}/certificate.pem}"
COMMON_NAME="${1:-$(hostname --fqdn 2>/dev/null || hostname)}"
VALID_DAYS="${CHROMA_SELF_SIGNED_VALID_DAYS:-825}"

if ! id "${CHROMA_USER}" >/dev/null 2>&1 || ! getent group "${CHROMA_GROUP}" >/dev/null 2>&1; then
  echo "Create the ${CHROMA_USER}:${CHROMA_GROUP} service account before generating the certificate." >&2
  exit 1
fi

if [[ ! "${COMMON_NAME}" =~ ^[A-Za-z0-9.*:-]+$ ]]; then
  echo "The certificate common name contains unsupported characters." >&2
  exit 1
fi

if [[ -e "${KEY_PATH}" && -e "${CERTIFICATE_PATH}" ]]; then
  echo "Keeping the existing Chroma TLS key and certificate."
  exit 0
fi

if [[ -e "${KEY_PATH}" || -e "${CERTIFICATE_PATH}" ]]; then
  echo "Only one TLS file exists; refusing to overwrite a potentially recoverable certificate or key." >&2
  exit 1
fi

install -d -o "${CHROMA_USER}" -g "${CHROMA_GROUP}" -m 0750 "${PKI_DIR}"

temporary_directory="$(mktemp -d "${PKI_DIR}/install.XXXXXX")"
trap 'rm -rf "${temporary_directory}"' EXIT

key_temporary_path="${temporary_directory}/private.key"
certificate_temporary_path="${temporary_directory}/certificate.pem"

subject_alternative_names="DNS:localhost,IP:127.0.0.1,IP:::1"
if [[ "${COMMON_NAME}" == *:* || "${COMMON_NAME}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  subject_alternative_names="IP:${COMMON_NAME},${subject_alternative_names}"
else
  subject_alternative_names="DNS:${COMMON_NAME},${subject_alternative_names}"
fi

openssl genpkey \
  -algorithm RSA \
  -pkeyopt rsa_keygen_bits:3072 \
  -out "${key_temporary_path}"

openssl req \
  -x509 \
  -new \
  -sha256 \
  -key "${key_temporary_path}" \
  -out "${certificate_temporary_path}" \
  -days "${VALID_DAYS}" \
  -subj "/CN=${COMMON_NAME}" \
  -addext "subjectAltName=${subject_alternative_names}" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth"

install -o "${CHROMA_USER}" -g "${CHROMA_GROUP}" -m 0600 "${key_temporary_path}" "${KEY_PATH}"
install -o "${CHROMA_USER}" -g "${CHROMA_GROUP}" -m 0644 "${certificate_temporary_path}" "${CERTIFICATE_PATH}"

echo "Created Chroma's self-signed certificate for ${COMMON_NAME}."
