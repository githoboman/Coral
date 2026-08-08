import { Toaster } from "sileo";
import { useEffect, useState } from "react";

export const SileoToaster = () => {
  const [position, setPosition] = useState<any>("bottom-right");

  useEffect(() => {
    const handleResize = () => {
      setPosition(window.innerWidth < 768 ? "bottom-center" : "bottom-right");
    };

    // Initial check
    handleResize();

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 99999, pointerEvents: 'none' }}>
      <Toaster
        position={position}
        options={{
          fill: "#171717",
          styles: { description: "text-white/75!" },
        }}
      />
    </div>
  );
};
