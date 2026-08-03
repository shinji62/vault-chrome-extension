interface VaultLogoProps {
  size?: number;
  className?: string;
}

/**
 * "Brass Vault" mark — a gilded key-escutcheon with an obsidian keyhole.
 * Reads as a physical vault key, distinct across light & dark surfaces.
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
      <defs>
        <linearGradient id="vault-brass" x1="8" y1="4" x2="24" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E7C56A" />
          <stop offset="0.5" stopColor="#C99733" />
          <stop offset="1" stopColor="#9A6E22" />
        </linearGradient>
        <linearGradient id="vault-obsidian" x1="10" y1="8" x2="22" y2="25" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3A3426" />
          <stop offset="1" stopColor="#120F08" />
        </linearGradient>
      </defs>

      {/* Brass escutcheon (shield) */}
      <path
        d="M16 2.5l10.5 3.6V15c0 6.6-4.5 11.6-10.5 13.5C10.5 26.6 5.5 21.6 5.5 15V6.1L16 2.5z"
        fill="url(#vault-brass)"
      />
      {/* Engraved inner edge */}
      <path
        d="M16 5l7.5 2.6V15c0 5.2-3.4 9.3-7.5 11-4.1-1.7-7.5-5.8-7.5-11V7.6L16 5z"
        fill="none"
        stroke="#F3E0A6"
        strokeOpacity="0.5"
        strokeWidth="1"
      />

      {/* Obsidian keyhole */}
      <path
        d="M13.4 10.5L16 18.4l2.6-7.9"
        stroke="url(#vault-obsidian)"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="16" cy="20.6" r="1.9" fill="url(#vault-obsidian)" />
    </svg>
  );
}
