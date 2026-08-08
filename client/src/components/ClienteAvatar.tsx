interface ClienteAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: number;
}

/** Foto de perfil del cliente: imagen si hay avatarUrl, si no un círculo con las
 * iniciales del nombre como fallback (para no depender de librerías de avatares). */
export default function ClienteAvatar({ name, avatarUrl, size = 40 }: ClienteAvatarProps) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const style = { width: size, height: size };

  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className="rounded-full object-cover flex-shrink-0" style={style} />;
  }

  return (
    <div
      className="rounded-full bg-sky-100 text-sky-700 font-semibold flex items-center justify-center flex-shrink-0"
      style={{ ...style, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {initials || "?"}
    </div>
  );
}