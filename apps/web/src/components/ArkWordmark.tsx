import type { SVGProps } from "react";

export function ArkWordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 80 28" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 25 13 3 23 25M7 17h12M31 25V3h9c12 0 12 13 0 13h-9m10 0 9 9M58 3v22m17-22L59 15m5-4 13 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
