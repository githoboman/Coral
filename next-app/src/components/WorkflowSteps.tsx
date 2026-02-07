'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Circle } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export interface WorkflowStep {
  id: number;
  message: string;
  status: 'pending' | 'running' | 'completed';
}

interface WorkflowStepsProps {
  steps: WorkflowStep[];
}

const WorkflowSteps = ({ steps }: WorkflowStepsProps) => {
  if (steps.length === 0) return null;

  return (
    <div className="w-full max-w-2xl mx-auto my-4 bg-white/5 border border-white/10 rounded-xl p-4">
      <h4 className="text-xs font-semibold text-white/50 mb-3 uppercase tracking-wider">
        Agent Workflow
      </h4>
      <div className="space-y-3">
        <AnimatePresence>
          {steps.map((step) => (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-3 text-sm"
            >
              {step.status === 'completed' && (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              {step.status === 'running' && (
                <LoadingSpinner size={16} />
              )}
              {step.status === 'pending' && (
                <Circle className="w-4 h-4 text-white/20 shrink-0" />
              )}

              <span className={`
                ${step.status === 'completed' ? 'text-emerald-100/80 line-through decoration-emerald-500/30' : ''}
                ${step.status === 'running' ? 'text-white font-medium' : ''}
                ${step.status === 'pending' ? 'text-white/30' : ''}
              `}>
                {step.message}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default WorkflowSteps;
