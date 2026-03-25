'use client';

import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';

type Props = {
  markers: Array<{ id: string; posto: string; lat: number; lng: number; score: number; impacto: string }>;
};

export default function ProcessMap({ markers }: Props) {
  const center: LatLngExpression = markers.length > 0 ? [markers[0].lat, markers[0].lng] : [ -23.55, -46.63 ];

  return (
    <MapContainer center={center} zoom={11} scrollWheelZoom style={{ height: '330px', borderRadius: '0.75rem' }}>
      <TileLayer
        attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {markers.map((marker) => (
        <Marker key={marker.id} position={[marker.lat, marker.lng] as LatLngExpression}>
          <Popup>
            {marker.posto}<br />Score: {marker.score.toFixed(2)}<br/>{marker.impacto}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
