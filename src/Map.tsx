import React, { useEffect, useRef } from "react";
import { Linking } from "react-native";
import { WebView } from "react-native-webview";
import html from "./mapHtml";
import { MapProps } from "./Map.types";
export default function ConquerMap(props: MapProps) {
  const ref = useRef<WebView>(null);
  const ready = useRef(false);
  const send = () => {
    if (ready.current)
      ref.current?.injectJavaScript(
        "window.updateConquer(" + JSON.stringify(props) + ");true;",
      );
  };
  useEffect(send, [props]);
  return (
    <WebView
      ref={ref}
      source={{ html, baseUrl: "https://conquer.local" }}
      originWhitelist={["*"]}
      onMessage={() => {
        ready.current = true;
        send();
      }}
      onShouldStartLoadWithRequest={(r) => {
        if (
          r.url === "about:blank" ||
          r.url.startsWith("https://conquer.local")
        )
          return true;
        if (
          r.url === "https://www.openstreetmap.org/copyright" ||
          r.url === "https://leafletjs.com/"
        )
          void Linking.openURL(r.url);
        return false;
      }}
      style={{ flex: 1, backgroundColor: "#182027" }}
      javaScriptEnabled
      domStorageEnabled
    />
  );
}
