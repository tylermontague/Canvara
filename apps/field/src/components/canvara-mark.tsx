// The Canvara icon mark, built to the brand guide's construction spec:
// navy rounded-square badge, bold white C-arc (round caps, opening right),
// gold endpoint dots, soft centered white dot at 35%.

import Svg, { Rect, Path, Circle } from "react-native-svg";

export function CanvaraMark({ size = 64 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 400 400">
      <Rect width={400} height={400} rx={90} fill="#0F2A4A" />
      <Path
        d="M 267.5 119.6 A 105 105 0 1 0 267.5 280.4"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={52}
        strokeLinecap="round"
      />
      <Circle cx={95} cy={200} r={15} fill="#FFFFFF" opacity={0.35} />
      <Circle cx={267.5} cy={119.6} r={30} fill="#C8973A" />
      <Circle cx={267.5} cy={280.4} r={30} fill="#C8973A" />
    </Svg>
  );
}
