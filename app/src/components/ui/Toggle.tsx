
import { motion } from "framer-motion";

interface ToggleProps {
  isOn: boolean;
  onToggle: () => void;
}

export const Toggle = ({ isOn, onToggle }: ToggleProps) => {
  return (
    <div
      className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-300 ${isOn ? "bg-[#a3e635]" : "bg-white/20"
        }`}
      onClick={onToggle}
    >
      <motion.div
        className="bg-black w-4 h-4 rounded-full shadow-md"
        layout
        transition={{ type: "spring", stiffness: 700, damping: 30 }}
        style={{
          marginLeft: isOn ? "auto" : "0",
          marginRight: isOn ? "0" : "auto",
        }}
      />
    </div>
  );
};
