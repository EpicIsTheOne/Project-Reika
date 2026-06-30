import type { Status } from "../types";
import { statusLabels } from "../app/constants";

export function Toggle({ checked = false, disabled = false, onClick }: { checked?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button className={checked ? "toggle checked" : "toggle"} aria-pressed={checked} disabled={disabled} onClick={onClick}>
      <span />
    </button>
  );
}

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`status-pill status-${status}`}>
      <StatusDot status={status} />
      {statusLabels[status]}
    </span>
  );
}

export function StatusDot({ status }: { status: Status }) {
  return <i className={`status-dot status-${status}`} aria-hidden="true" />;
}
