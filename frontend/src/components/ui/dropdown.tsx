import { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Search } from 'lucide-react';
import { useRef } from 'react';
import { useOutsideClick } from '@/lib/utils';

interface DropdownItem {
  id: string;
  label: string;
  subLabel?: string;
  onClick: () => void;
  isActive?: boolean;
  customContent?: ReactNode;
  nestedDropdown?: {
    items: { label: string; onClick: () => void; icon?: ReactNode }[];
  };
}

interface DropdownProps {
  triggerLabel: string;
  triggerIcon?: ReactNode;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  items: DropdownItem[];
  width?: string;
  maxHeight?: string;
  nestedOpenId?: string | null;
  setNestedOpenId?: (id: string | null) => void;
  searchValue?: string;
  setSearchValue?: (value: string) => void;
  searchPlaceholder?: string;
}

const Dropdown = ({
  triggerLabel,
  triggerIcon,
  isOpen,
  setIsOpen,
  items,
  width = 'w-80',
  maxHeight = 'max-h-64',
  nestedOpenId,
  setNestedOpenId,
  searchValue = '',
  setSearchValue,
  searchPlaceholder = 'Search...',
}: DropdownProps) => {
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useOutsideClick(dropdownRef, () => {
    if (isOpen) {
      setIsOpen(false);
      if (setNestedOpenId) setNestedOpenId(null);
    }
  });

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-white/10 hover:bg-white/20 text-white/80 px-4 py-3 rounded-[25px] border border-white/10 flex items-center gap-2 transition-all duration-200 cursor-pointer"
      >
        <span>{triggerLabel}</span>
        {triggerIcon || (
          <ChevronDown
            size={16}
            className={`transform transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className={`absolute top-full left-0 mt-2 ${width} bg-[#1d1d1d]/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-lg z-10`}
          >
            <div className={`flex flex-col ${maxHeight} overflow-y-auto`}>
              {setSearchValue && (
                <div className="p-2 border-b border-white/10">
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white/60" />
                    <input
                      type="text"
                      value={searchValue}
                      onChange={(e) => setSearchValue(e.target.value)}
                      placeholder={searchPlaceholder}
                      className="w-full bg-white/10 text-white pl-10 pr-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-white/20 placeholder-white/40"
                    />
                  </div>
                </div>
              )}
              <div className="p-2 flex-1 overflow-y-auto">
                {items.length === 0 ? (
                  <p className="text-white/60 text-sm p-2">No items available</p>
                ) : (
                  items.map((item) => (
                    <div key={item.id} className="relative flex items-center justify-between p-2">
                      {item.customContent ? (
                        item.customContent
                      ) : (
                        <motion.button
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          onClick={item.onClick}
                          className={`flex-1 text-left p-2 rounded-lg hover:bg-white/10 text-white/80 transition-all duration-200 cursor-pointer ${
                            item.isActive ? 'bg-white/20' : ''
                          }`}
                        >
                          <p className="text-sm font-semibold">{item.label}</p>
                          {item.subLabel && (
                            <p className="text-xs text-white/40">{item.subLabel}</p>
                          )}
                        </motion.button>
                      )}
                      {item.nestedDropdown && setNestedOpenId && (
                        <div className="relative">
                          <button
                            onClick={() =>
                              setNestedOpenId(nestedOpenId === item.id ? null : item.id)
                            }
                            className="p-1 text-white/60 hover:text-white/80 cursor-pointer"
                          >
                            {item.nestedDropdown.items[0]?.icon}
                          </button>

                          <AnimatePresence>
                            {nestedOpenId === item.id && (
                              <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.2 }}
                                className="absolute right-0 top-full mt-1 w-40 bg-[#1d1d1d]/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-lg z-20"
                              >
                                {item.nestedDropdown.items.map((nestedItem, index) => (
                                  <button
                                    key={index}
                                    onClick={nestedItem.onClick}
                                    className="w-full text-left p-2 text-sm text-white/80 hover:bg-white/10 flex items-center gap-2 cursor-pointer"
                                  >
                                    {nestedItem.icon}
                                    {nestedItem.label}
                                  </button>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Dropdown;