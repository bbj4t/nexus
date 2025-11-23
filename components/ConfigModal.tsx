import React, { useState } from 'react';
import { AppConfig } from '../types';

interface ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AppConfig;
  onSave: (config: AppConfig) => void;
}

export function ConfigModal({ isOpen, onClose, config, onSave }: ConfigModalProps) {
  const [formData, setFormData] = useState<AppConfig>(config);

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' || name === 'vadThreshold' ? parseFloat(value) : value
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-lg p-6 rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-white">Agent Configuration</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <i className="fa-solid fa-xmark text-xl"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* API Key */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
              Google Gemini API Key
            </label>
            <input
              type="password"
              name="apiKey"
              value={formData.apiKey}
              onChange={handleChange}
              placeholder="Leave empty to use env API_KEY"
              className="w-full bg-slate-800/50 border border-slate-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>

           {/* Model Selection */}
           <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
              Model
            </label>
             <select
              name="modelName"
              value={formData.modelName}
              onChange={handleChange}
              className="w-full bg-slate-800/50 border border-slate-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="gemini-2.5-flash-native-audio-preview-09-2025">Gemini 2.5 Flash Native Audio (Preview)</option>
              <option value="gemini-2.5-flash-latest">Gemini 2.5 Flash</option>
              <option value="gemini-3-pro-preview">Gemini 3.0 Pro</option>
            </select>
          </div>

          {/* Voice Selection */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
              Voice
            </label>
            <select
              name="voiceName"
              value={formData.voiceName}
              onChange={handleChange}
              className="w-full bg-slate-800/50 border border-slate-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="Puck">Puck</option>
              <option value="Charon">Charon</option>
              <option value="Kore">Kore</option>
              <option value="Fenrir">Fenrir</option>
              <option value="Zephyr">Zephyr</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-slate-700/50 pt-4 mt-2">
            <div className="col-span-2 text-xs font-semibold text-blue-400 uppercase">Supabase Configuration</div>
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
                Project URL
              </label>
              <input
                type="text"
                name="supabaseUrl"
                value={formData.supabaseUrl}
                onChange={handleChange}
                placeholder="https://xyz.supabase.co"
                className="w-full bg-slate-800/50 border border-slate-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
                Anon Key
              </label>
              <input
                type="password"
                name="supabaseKey"
                value={formData.supabaseKey}
                onChange={handleChange}
                placeholder="public-anon-key"
                className="w-full bg-slate-800/50 border border-slate-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* System Instruction */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
              System Instruction
            </label>
            <textarea
              name="systemInstruction"
              value={formData.systemInstruction}
              onChange={handleChange}
              rows={3}
              className="w-full bg-slate-800/50 border border-slate-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* VAD Settings */}
          <div className="grid grid-cols-2 gap-4 border-t border-slate-700/50 pt-4 mt-2">
            <div className="col-span-2 text-xs font-semibold text-blue-400 uppercase">Audio Settings</div>
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
                VAD Threshold ({formData.vadThreshold})
              </label>
              <input
                type="range"
                name="vadThreshold"
                min="0.001"
                max="0.5"
                step="0.001"
                value={formData.vadThreshold}
                onChange={handleChange}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
                Silence Timeout ({formData.vadSilenceTimeout}ms)
              </label>
              <input
                type="number"
                name="vadSilenceTimeout"
                value={formData.vadSilenceTimeout}
                onChange={handleChange}
                className="w-full bg-slate-800/50 border border-slate-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded text-sm text-gray-300 hover:text-white hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2 rounded text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 transition-all"
            >
              Save Configuration
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}