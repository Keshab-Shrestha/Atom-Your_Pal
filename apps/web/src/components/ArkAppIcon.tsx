import appIconUrl from "../../../../atom/assets/icon/icon-1024.png";

export function ArkAppIcon(props: { readonly className?: string }) {
  return <img src={appIconUrl} alt="" className={props.className} />;
}
