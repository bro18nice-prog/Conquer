const fs = require("fs"),
  path = require("path");
const root = path.join(__dirname, "..");
const css = fs.readFileSync(
  path.join(root, "node_modules/leaflet/dist/leaflet.css"),
  "utf8",
);
const js = fs.readFileSync(
  path.join(root, "node_modules/leaflet/dist/leaflet.js"),
  "utf8",
);
const html =
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>' +
  css +
  'html,body,#map{height:100%;margin:0;background:#161c21} .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) saturate(.28) brightness(.75)} .leaflet-container{background:#182027;font-family:Arial}.leaflet-control-attribution{background:#111a20dd!important;color:#a9b5b5!important;font-size:9px!important}.leaflet-control-attribution a{color:#b7c6b9}.leaflet-control-zoom a{background:#20292a!important;color:#e3eddb!important;border-color:#3c4747!important}.leaflet-tooltip{background:#172020e8;border:1px solid #526044;color:#e4eedb;box-shadow:none;border-radius:7px;font-size:11px;padding:6px 10px}.leaflet-tooltip:before{display:none}.leaflet-bottom{bottom:6px}#offline{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:999;background:#293228;color:#e9edda;padding:7px 14px;border-radius:20px;font:11px Arial;display:none}</style></head><body><div id="map"></div><div id="offline">Harta nu se încarcă · traseul rămâne disponibil</div><script>' +
  js +
  "</script><script>" +
  `const map=L.map('map',{zoomControl:false}).setView([44.438,26.088],14);
L.control.zoom({position:'bottomright'}).addTo(map);
const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'}).addTo(map);
tiles.on('tileerror',()=>document.getElementById('offline').style.display='block');
tiles.on('tileload',()=>document.getElementById('offline').style.display='none');
const shapes=L.layerGroup().addTo(map),track=L.layerGroup().addTo(map);
let lastFocus=-1;
window.updateConquer=function(d){
 shapes.clearLayers();track.clearLayers();
 for(const t of d.territories){const p=d.players.find(p=>p.id===t.playerId)||{name:'Jucător',color:'#d5fc51'};
 const layer=L.geoJSON({type:'Feature',properties:{},geometry:{type:'MultiPolygon',coordinates:t.polygon}},{style:{color:p.color,weight:2,fillColor:p.color,fillOpacity:.23}}).addTo(shapes);
 const label=document.createElement('span');label.textContent=p.name.toUpperCase()+' · '+(t.area/1e6).toFixed(3)+' km²';layer.bindTooltip(label,{permanent:true,direction:'center'});}
 const pts=d.points.map(p=>[p.latitude,p.longitude]);
 if(pts.length){L.polyline(pts,{color:'#d5fc51',weight:4}).addTo(track);L.circleMarker(pts[0],{radius:5,color:'#d5fc51',fillOpacity:1}).addTo(track);L.circleMarker(pts[pts.length-1],{radius:7,color:'#fff',fillColor:'#d5fc51',fillOpacity:1,weight:3}).addTo(track);}
 if(d.focus!==lastFocus){lastFocus=d.focus;if(d.center)map.setView([d.center.latitude,d.center.longitude],16);else if(pts.length>1)map.fitBounds(pts,{padding:[45,45],maxZoom:17});else {const coordinates=d.territories.flatMap(t=>t.polygon.flatMap(p=>p.flatMap(r=>r.map(c=>[c[1],c[0]]))));if(coordinates.length)map.fitBounds(coordinates,{padding:[55,55],maxZoom:15});}}
};
addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='conquer')window.updateConquer(e.data.payload)});
if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage('ready');else parent.postMessage('conquer-ready','*');
` +
  "</script></body></html>";
fs.writeFileSync(
  path.join(root, "src/mapHtml.ts"),
  "// Generated from bundled Leaflet. Run node scripts/build-map.cjs to regenerate.\nexport default " +
    JSON.stringify(html) +
    ";\n",
);
