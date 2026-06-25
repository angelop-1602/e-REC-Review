import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

function getRequiredMailEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required mail environment variable: ${name}`);
  }

  return value;
}

function getMailPort(): number {
  const rawPort = getRequiredMailEnv('MAIL_PORT');
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`MAIL_PORT must be a valid port number. Received: ${rawPort}`);
  }

  return port;
}

function shouldUseSecureConnection(encryption: string, port: number): boolean {
  const normalizedEncryption = encryption.toLowerCase();

  return normalizedEncryption === 'ssl' || normalizedEncryption === 'smtps' || port === 465;
}

function shouldRequireTls(encryption: string): boolean {
  const normalizedEncryption = encryption.toLowerCase();

  return normalizedEncryption === 'tls' || normalizedEncryption === 'starttls';
}

export function getMailTransporter(): Transporter {
  if (transporter) {
    return transporter;
  }

  const mailer = process.env.MAIL_MAILER?.toLowerCase() ?? 'smtp';

  if (mailer !== 'smtp') {
    throw new Error(`Unsupported MAIL_MAILER value: ${process.env.MAIL_MAILER}. Only smtp is supported.`);
  }

  const host = getRequiredMailEnv('MAIL_HOST');
  const port = getMailPort();
  const encryption = process.env.MAIL_ENCRYPTION ?? '';
  const username = process.env.MAIL_USERNAME;
  const password = process.env.MAIL_PASSWORD;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: shouldUseSecureConnection(encryption, port),
    requireTLS: shouldRequireTls(encryption),
    auth: username && password
      ? {
          user: username,
          pass: password,
        }
      : undefined,
  });

  return transporter;
}

export function getMailFrom() {
  return {
    address: getRequiredMailEnv('MAIL_FROM_ADDRESS'),
    name: process.env.MAIL_FROM_NAME || 'e-REC Ethics Review System',
  };
}
