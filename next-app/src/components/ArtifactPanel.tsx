'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Check, Code2, FileText, Layout } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { Artifact } from '@/store/slices/chatsSlice';

interface ArtifactPanelProps {
  artifact: Artifact | null;
  onClose: () => void;
}

const ArtifactPanel: React.FC<ArtifactPanelProps> = ({ artifact, onClose }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    if (typeof window !== 'undefined' && window.navigator.clipboard && artifact?.content) {
      window.navigator.clipboard.writeText(artifact.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'code': return <Code2 className="w-5 h-5 text-blue-400" />;
      case 'markdown': return <FileText className="w-5 h-5 text-purple-400" />;
      case 'react': return <Layout className="w-5 h-5 text-emerald-400" />;
      default: return <FileText className="w-5 h-5 text-gray-400" />;
    }
  };

  return (
    <AnimatePresence>
      {artifact && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="fixed top-0 right-0 h-screen w-full md:w-[45vw] bg-[#0d1117] border-l border-white/10 shadow-2xl z-50 flex flex-col"
        >
          <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5">
            <div className="flex items-center gap-3">
              {getIcon(artifact.type)}
              <div>
                <h3 className="font-semibold text-white text-sm">{artifact.title}</h3>
                <p className="text-xs text-gray-400 capitalize">{artifact.type} - {artifact.language || 'Text'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-400 hover:text-white"
                title="Copy content"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {artifact.type === 'code' || artifact.type === 'react' ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeHighlight, rehypeKatex]}
                components={{
                  code({ className, children, ...props }) {
                    return (
                      <code className={`${className} !bg-transparent !p-0 block font-mono text-sm leading-relaxed`} {...props}>
                        {children}
                      </code>
                    );
                  }
                }}
              >
                {`\`\`\`${artifact.language || 'text'}\n${artifact.content}\n\`\`\``}
              </ReactMarkdown>
            ) : (
              <div className="prose prose-invert max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeHighlight, rehypeKatex]}
                >
                  {artifact.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ArtifactPanel;
