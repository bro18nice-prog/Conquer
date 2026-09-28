import React, { useEffect, useRef } from "react";
import html from "./mapHtml";
import { MapProps } from "./Map.types";
export default function ConquerMap(props: MapProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const send = () =>
    ref.current?.contentWindow?.postMessage(
      { type: "conquer", payload: latest.current },
      "*",
    );
  useEffect(() => {
    send();
  }, [props]);
  useEffect(() => {
    const ready = (e: MessageEvent) => {
      if (e.source === ref.current?.contentWindow && e.data === "conquer-ready")
        send();
    };
    window.addEventListener("message", ready);
    return () => window.removeEventListener("message", ready);
  }, []);
  return (
    <iframe
      ref={ref}
      title="Harta teritoriilor Conquer"
      srcDoc={html}
      onLoad={send}
      sandbox="allow-scripts allow-same-origin allow-popups"
      style={{ width: "100%", height: "100%", border: 0, display: "block" }}
    />
  );
}
