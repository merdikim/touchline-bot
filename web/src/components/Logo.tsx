/**
 * The Touchline mark, drawn in CSS: night pitch, grass strip, the white
 * sideline the product is named after, and the bot's cyan eyes.
 */
export function Logo({ size = 34 }: { size?: number }) {
  const unit = size / 34;

  return (
    <div
      aria-hidden="true"
      className="relative shrink-0 overflow-hidden rounded-full bg-mark"
      style={{ width: size, height: size }}
    >
      {/* Grass */}
      <div
        className="absolute inset-x-0 bottom-0 bg-pitch"
        style={{ height: 11 * unit }}
      />
      {/* Sideline */}
      <div
        className="absolute inset-y-0 bg-canvas"
        style={{ left: 22 * unit, width: Math.max(1, 2 * unit) }}
      />
      {/* Eyes */}
      {[10, 18].map((left) => (
        <div
          key={left}
          className="absolute rounded-full bg-mark-eye"
          style={{ left: left * unit, top: 10 * unit, width: 5 * unit, height: 5 * unit }}
        />
      ))}
    </div>
  );
}
