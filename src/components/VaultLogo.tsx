interface VaultLogoProps {
  size?: number;
  className?: string;
}

/**
 * HashiCorp Vault-inspired SVG logo mark.
 * Dark navy shield with the Vault yellow "V" mark — matching HashiCorp Vault's
 * product icon colour scheme (#FFD814 yellow on #0D1B2A navy).
 */
export function VaultLogo({ size = 28, className }: VaultLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Shield background — Vault dark navy */}
      <rect
        x="2"
        y="2"
        width="28"
        height="28"
        rx="6"
        fill="#0D1B2A"
      />
      {/* Stylised V mark — Vault yellow */}
      <path
        d="M8.5 9.5L16 22.5L23.5 9.5"
        stroke="#FFD814"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Centre dot — Vault yellow */}
      <circle cx="16" cy="22.5" r="1.5" fill="#FFD814" />
    </svg>
  );
}
