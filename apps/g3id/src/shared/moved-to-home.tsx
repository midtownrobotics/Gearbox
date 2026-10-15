import { appUrl } from "@g3/site-config";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export function MovedToHome({ to }: { to?: string }) {
  const { pathname, search, hash } = useLocation();
  useEffect(() => {
    const target = to ?? (pathname === "/" || pathname === "/dashboard" ? "/account" : pathname);
    window.location.replace(`${appUrl("portal")}${target}${search}${hash}`);
  }, [to, pathname, search, hash]);
  return null;
}
