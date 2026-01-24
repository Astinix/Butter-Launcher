import React from "react";
import { IconX } from "@tabler/icons-react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-md animate-fade-in"
      onClick={onCancel}
    >
      <div
        className="relative w-full max-w-md rounded-xl shadow-2xl bg-linear-to-b from-[#1b2030]/95 to-[#141824]/95 border border-[#2a3146] p-6 animate-settings-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="text-white font-extrabold text-lg">{title}</div>
          <button
            type="button"
            className="w-8 h-8 rounded-full bg-[#23293a] text-gray-400 hover:text-white hover:bg-[#2f3650] transition flex items-center justify-center"
            onClick={onCancel}
            title="Close"
          >
            <IconX size={20} />
          </button>
        </div>

        {/* Message */}
        <div className="mt-4 text-sm text-gray-200 whitespace-pre-wrap">
          {message}
        </div>

        {/* Buttons */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="px-4 py-2 rounded-lg border border-[#2a3146] text-gray-300 hover:text-white hover:bg-[#2f3650] transition"
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-linear-to-r from-[#2563eb] to-[#60a5fa] text-white font-bold hover:scale-[1.02] transition"
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
