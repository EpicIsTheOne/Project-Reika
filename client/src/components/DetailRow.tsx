import type { ElementType } from "react";

export function DetailRow({
  label,
  value,
  icon,
  image
}: {
  label: string;
  value: string;
  icon?: ElementType;
  image?: string;
}) {
  const Icon = icon;
  return (
    <div className="detail-row">
      {image ? <img src={image} alt="" /> : Icon ? <Icon size={17} /> : null}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
