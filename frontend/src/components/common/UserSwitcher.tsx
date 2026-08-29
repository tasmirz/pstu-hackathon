import React from 'react';
import { useAuth } from '@/lib/auth-context';
import { Users, RotateCcw, Cpu, Database } from 'lucide-react';
import { formatPaisa } from '@/lib/money';

export const PERSONAS = [
  { id: 42, name: 'Rahim Ahmed', phone: '+8801712345678', pin: '1234', role: 'Sender' },
  { id: 43, name: 'Karim Uddin', phone: '+8801798765432', pin: '1234', role: 'Receiver' },
  { id: 44, name: 'Alam Hossain', phone: '+8801733445566', pin: '1234', role: 'Requester' },
  { id: 45, name: 'Nadia Sultana', phone: '+8801755667788', pin: '1234', role: 'New User' },
  { id: 1, name: 'System Admin', phone: '+8801700000000', pin: '9999', role: 'Admin' },
];

export function UserSwitcher() {
  const { user, switchUser, isMockMode, toggleMockMode, resetDemoData, balance } = useAuth();

  return (
    <div className="bg-surface-container-low border-b border-outline-variant px-4 py-2 flex flex-wrap items-center justify-between text-xs gap-3">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 font-semibold text-on-surface-variant">
          <Users className="w-3.5 h-3.5 text-primary" />
          <span>Demo Persona:</span>
        </span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {PERSONAS.map((p) => {
            const isActive = user?.id === p.id;
            return (
              <button
                key={p.id}
                onClick={() => switchUser(p.id)}
                className={`px-2.5 py-1 rounded text-xs transition-all font-medium flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-primary text-white shadow-xs font-semibold'
                    : 'bg-surface-container hover:bg-surface-container-high text-on-surface'
                }`}
              >
                <span>{p.name.split(' ')[0]}</span>
                <span className={`text-[10px] ${isActive ? 'text-primary-fixed' : 'text-on-surface-variant'}`}>
                  ({p.role})
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 ml-auto">
        <button
          onClick={toggleMockMode}
          title="Toggle between browser simulation and live NestJS backend"
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-medium transition-colors ${
            isMockMode
              ? 'bg-amber-100 text-amber-900 border border-amber-300'
              : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
          }`}
        >
          {isMockMode ? <Cpu className="w-3.5 h-3.5" /> : <Database className="w-3.5 h-3.5" />}
          <span>{isMockMode ? 'Mock Simulator Active' : 'Live Nest API (3000)'}</span>
        </button>

        <button
          onClick={resetDemoData}
          title="Reset balances & transactions to clean starting state"
          className="flex items-center gap-1 px-2.5 py-1 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset State</span>
        </button>
      </div>
    </div>
  );
}
