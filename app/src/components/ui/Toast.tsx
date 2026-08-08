
import { useEffect, useState } from "react";
import { X, CheckCircle, AlertCircle, Info } from "lucide-react";

export type ToastType = "success" | "error" | "info" | "warning";

interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose: () => void;
}

export const Toast = ({ message, type = "info", duration = 3000, onClose }: ToastProps) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300); // Allow exit animation to finish
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const getIcon = () => {
    switch (type) {
      case "success":
        return <CheckCircle className="text-[#B7FC0D]" size={20} />;
      case "error":
        return <AlertCircle className="text-red-500" size={20} />;
      case "warning":
        return <AlertCircle className="text-yellow-500" size={20} />;
      case "info":
      default:
        return <Info className="text-blue-500" size={20} />;
    }
  };

  const getBorderColor = () => {
    switch (type) {
      case "success":
        return "border-[#B7FC0D]/20";
      case "error":
        return "border-red-500/20";
      case "warning":
        return "border-yellow-500/20";
      case "info":
      default:
        return "border-white/10";
    }
  };

  return (
    <div
      className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 bg-[#0A0A0A] border ${getBorderColor()} text-white px-4 py-3 rounded-xl shadow-2xl transition-all duration-300 transform ${isVisible ? "translate-y-0 opacity-100 scale-100" : "-translate-y-4 opacity-0 scale-95"
        }`}
    >
      {getIcon()}
      <span className="text-sm font-medium">{message}</span>
      <button onClick={() => setIsVisible(false)} className="text-white/40 hover:text-white transition-colors ml-2">
        <X size={16} />
      </button>
    </div>
  );
};