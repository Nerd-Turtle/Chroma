import { createPrivateKey, randomUUID, X509Certificate } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { createSecureContext } from "node:tls";
import { promisify } from "node:util";
import type {
  GeneratePkiCsrRequest,
  GeneratePkiCsrResponse,
  InstallPkiCertificateResponse,
  PkiCertificateStatus,
  PkiStatusResponse,
} from "../../shared/types/index.js";
import { getPkiPaths } from "../config/paths.js";

const execFileAsync = promisify(execFile);
const MAX_CERTIFICATE_PEM_BYTES = 128 * 1024;
const DNS_LABEL_PATTERN = /^(?:\*|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/i;
const CERTIFICATE_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const SUBJECT_VALUE_PATTERN = /^[a-z0-9 .,'()&@_-]+$/i;

export type TlsCertificateMaterial = {
  key: Buffer;
  cert: Buffer;
};

export type PkiServiceOptions = {
  onCertificateInstalled?: (material: TlsCertificateMaterial) => void | Promise<void>;
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function assertValidDnsName(value: string): void {
  if (value.length === 0 || value.length > 253) {
    throw new Error("DNS names must be between 1 and 253 characters");
  }

  const labels = value.endsWith(".") ? value.slice(0, -1).split(".") : value.split(".");
  if (
    labels.some((label, index) => !DNS_LABEL_PATTERN.test(label) || (label === "*" && index !== 0))
  ) {
    throw new Error(`Invalid DNS name: ${value}`);
  }
}

function normalizeCsrRequest(input: GeneratePkiCsrRequest): GeneratePkiCsrRequest {
  const commonName = input.commonName.trim();
  if (isIP(commonName) === 0) {
    assertValidDnsName(commonName);
  }

  const dnsNames = [...new Set(input.dnsNames.map((value) => value.trim()).filter(Boolean))];
  const ipAddresses = [...new Set(input.ipAddresses.map((value) => value.trim()).filter(Boolean))];

  for (const dnsName of dnsNames) {
    assertValidDnsName(dnsName);
  }
  for (const ipAddress of ipAddresses) {
    if (isIP(ipAddress) === 0) {
      throw new Error(`Invalid IP address: ${ipAddress}`);
    }
  }

  if (isIP(commonName) > 0) {
    if (!ipAddresses.includes(commonName)) ipAddresses.unshift(commonName);
  } else if (!dnsNames.includes(commonName)) {
    dnsNames.unshift(commonName);
  }

  if (dnsNames.length + ipAddresses.length > 50) {
    throw new Error("A CSR may contain at most 50 subject alternative names");
  }

  const subjectFields = {
    organization: input.organization?.trim(),
    organizationalUnit: input.organizationalUnit?.trim(),
    country: input.country?.trim().toUpperCase(),
    stateOrProvince: input.stateOrProvince?.trim(),
    locality: input.locality?.trim(),
  };
  for (const [field, value] of Object.entries(subjectFields)) {
    if (!value) continue;
    if (value.length > 128 || !SUBJECT_VALUE_PATTERN.test(value)) {
      throw new Error(`${field} contains unsupported characters or is too long`);
    }
  }
  if (subjectFields.country && !/^[A-Z]{2}$/.test(subjectFields.country)) {
    throw new Error("country must be a two-letter country code");
  }

  return {
    commonName,
    dnsNames,
    ipAddresses,
    ...(subjectFields.organization ? { organization: subjectFields.organization } : {}),
    ...(subjectFields.organizationalUnit ? { organizationalUnit: subjectFields.organizationalUnit } : {}),
    ...(subjectFields.country ? { country: subjectFields.country } : {}),
    ...(subjectFields.stateOrProvince ? { stateOrProvince: subjectFields.stateOrProvince } : {}),
    ...(subjectFields.locality ? { locality: subjectFields.locality } : {}),
  };
}

function getCommonName(subject: string): string | undefined {
  const match = /(?:^|\n|,\s*)CN\s*=\s*([^,\n]+)/.exec(subject);
  return match?.[1]?.trim();
}

function describeCertificate(certificate: X509Certificate): PkiCertificateStatus {
  const commonName = getCommonName(certificate.subject);
  return {
    configured: true,
    tlsEnabled: process.env.CHROMA_TLS_ENABLED === "true",
    ...(commonName ? { commonName } : {}),
    issuer: certificate.issuer,
    ...(certificate.subjectAltName ? { subjectAlternativeName: certificate.subjectAltName } : {}),
    validFrom: new Date(certificate.validFrom).toISOString(),
    validTo: new Date(certificate.validTo).toISOString(),
    fingerprintSha256: certificate.fingerprint256,
    selfSigned: certificate.subject === certificate.issuer && certificate.verify(certificate.publicKey),
  };
}

function readLeafCertificate(pem: string): X509Certificate {
  const certificates = pem.match(CERTIFICATE_PATTERN);
  if (!certificates || certificates.length === 0) {
    throw new Error("The uploaded file does not contain a PEM certificate");
  }

  for (const certificatePem of certificates) {
    new X509Certificate(certificatePem);
  }

  return new X509Certificate(certificates[0]);
}

async function writeAtomic(path: string, content: string | Buffer, mode: number): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { mode, flag: "wx" });
    await chmod(temporaryPath, mode);
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export async function getPkiStatus(): Promise<PkiStatusResponse> {
  const paths = getPkiPaths();
  const [privateKeyAvailable, certificateSigningRequestAvailable, certificateAvailable] = await Promise.all([
    fileExists(paths.privateKey),
    fileExists(paths.certificateSigningRequest),
    fileExists(paths.certificate),
  ]);

  let certificate: PkiCertificateStatus = {
    configured: false,
    tlsEnabled: process.env.CHROMA_TLS_ENABLED === "true",
  };

  if (certificateAvailable) {
    const certificatePem = await readFile(paths.certificate, "utf8");
    certificate = describeCertificate(readLeafCertificate(certificatePem));
  }

  return { certificate, privateKeyAvailable, certificateSigningRequestAvailable };
}

export async function generatePkiCsr(input: GeneratePkiCsrRequest): Promise<GeneratePkiCsrResponse> {
  const paths = getPkiPaths();
  const request = normalizeCsrRequest(input);

  if (!(await fileExists(paths.privateKey))) {
    if (await fileExists(paths.certificate)) {
      throw new Error("The TLS private key is missing but a certificate exists. Repair the Chroma installation before generating a CSR.");
    }

    await mkdir(paths.directory, { recursive: true, mode: 0o750 });
    const temporaryKeyPath = `${paths.privateKey}.${randomUUID()}.tmp`;
    try {
      await execFileAsync(
        "openssl",
        ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:3072", "-out", temporaryKeyPath],
        { maxBuffer: 1024 * 1024 },
      );
      await chmod(temporaryKeyPath, 0o600);
      await rename(temporaryKeyPath, paths.privateKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenSSL failed to generate the private key";
      throw new Error(`Unable to initialize the TLS private key: ${message}`);
    } finally {
      await unlink(temporaryKeyPath).catch(() => undefined);
    }
  }

  await mkdir(paths.directory, { recursive: true, mode: 0o750 });
  const temporaryPath = `${paths.certificateSigningRequest}.${randomUUID()}.tmp`;
  const subjectAlternativeNames = [
    ...request.dnsNames.map((value) => `DNS:${value}`),
    ...request.ipAddresses.map((value) => `IP:${value}`),
  ].join(",");
  const subject = [
    `/CN=${request.commonName}`,
    request.organization ? `/O=${request.organization}` : "",
    request.organizationalUnit ? `/OU=${request.organizationalUnit}` : "",
    request.country ? `/C=${request.country}` : "",
    request.stateOrProvince ? `/ST=${request.stateOrProvince}` : "",
    request.locality ? `/L=${request.locality}` : "",
  ].join("");

  try {
    await execFileAsync(
      "openssl",
      [
        "req",
        "-new",
        "-sha256",
        "-key",
        paths.privateKey,
        "-out",
        temporaryPath,
        "-subj",
        subject,
        "-addext",
        `subjectAltName=${subjectAlternativeNames}`,
        "-addext",
        "extendedKeyUsage=serverAuth",
        "-addext",
        "keyUsage=digitalSignature,keyEncipherment",
      ],
      { maxBuffer: 1024 * 1024 },
    );
    await chmod(temporaryPath, 0o644);
    await rename(temporaryPath, paths.certificateSigningRequest);
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenSSL failed to generate the CSR";
    throw new Error(`Unable to generate certificate signing request: ${message}`);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }

  const csrPem = await readFile(paths.certificateSigningRequest, "utf8");
  return { csrPem, fileName: "chroma.csr" };
}

export async function installPkiCertificate(
  certificatePemInput: string,
  options: PkiServiceOptions = {},
): Promise<InstallPkiCertificateResponse> {
  const paths = getPkiPaths();
  const certificatePem = certificatePemInput.trimEnd() + "\n";
  if (Buffer.byteLength(certificatePem, "utf8") > MAX_CERTIFICATE_PEM_BYTES) {
    throw new Error("The certificate chain must be 128 KiB or smaller");
  }

  const privateKeyPem = await readFile(paths.privateKey);
  const leafCertificate = readLeafCertificate(certificatePem);
  const privateKey = createPrivateKey(privateKeyPem);

  if (!leafCertificate.checkPrivateKey(privateKey)) {
    throw new Error("The signed certificate does not match Chroma's private key");
  }
  if (leafCertificate.ca) {
    throw new Error("The first certificate in the file must be the server certificate, not a CA certificate");
  }

  const now = Date.now();
  if (new Date(leafCertificate.validFrom).getTime() > now) {
    throw new Error("The signed certificate is not valid yet");
  }
  if (new Date(leafCertificate.validTo).getTime() <= now) {
    throw new Error("The signed certificate has expired");
  }

  createSecureContext({ key: privateKeyPem, cert: certificatePem });
  await mkdir(paths.backupsDirectory, { recursive: true, mode: 0o750 });

  const previousCertificate = (await fileExists(paths.certificate)) ? await readFile(paths.certificate) : undefined;
  if (previousCertificate) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${paths.backupsDirectory}/certificate-${timestamp}-${randomUUID()}.pem`;
    await copyFile(paths.certificate, backupPath, constants.COPYFILE_EXCL);
  }

  await writeAtomic(paths.certificate, certificatePem, 0o644);

  try {
    await options.onCertificateInstalled?.({ key: privateKeyPem, cert: Buffer.from(certificatePem) });
  } catch (error) {
    if (previousCertificate) {
      await writeAtomic(paths.certificate, previousCertificate, 0o644);
      try {
        await options.onCertificateInstalled?.({ key: privateKeyPem, cert: previousCertificate });
      } catch {
        // The original certificate is back on disk even if restoring the live context fails.
      }
    }
    const message = error instanceof Error ? error.message : "the live TLS reload failed";
    throw new Error(`The certificate was valid but could not be activated: ${message}`);
  }

  return {
    ...(await getPkiStatus()),
    reloaded: options.onCertificateInstalled !== undefined,
  };
}
