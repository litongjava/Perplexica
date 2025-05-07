'use client';

import React, { useState } from 'react';

interface CitationTooltipProps {
  content: string; // This is the content to be copied
  title?: string;
  url?: string;
  visible: boolean;
  position: { top: number; left: number };
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const CitationTooltip = ({
                           content,
                           title,
                           url,
                           visible,
                           position,
                           onMouseEnter,
                           onMouseLeave,
                         }: CitationTooltipProps) => {
  const [copied, setCopied] = useState(false); // State to show copy success

  if (!visible) return null;

  const MAX_CONTENT_LENGTH = 300;
  const truncatedContent =
    content.length > MAX_CONTENT_LENGTH
      ? content.substring(0, MAX_CONTENT_LENGTH) + '...'
      : content;



  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content); // Copy the full content
      setCopied(true);
      setTimeout(() => setCopied(false), 1500); // Reset copy status after 1.5 seconds
    } catch (err) {
      console.error('Failed to copy text: ', err);
      // You can add an error notification here, e.g., using a toast
    }
  };

  return (
    <div
      id="citation-tooltip-element"
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        transform: 'translate(-50%, -105%)',
        zIndex: 1000,
        background: 'white',
        border: '1px solid #ccc',
        borderRadius: '4px',
        padding: '10px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        maxWidth: '400px',
        fontSize: '0.875rem',
        color: '#333',
        pointerEvents: 'auto',
      }}
      className="dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {title && <h4 style={{ margin: '0 0 5px 0', fontWeight: 'bold' }}>{title}</h4>}
      <p style={{ margin: '0 0 8px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {truncatedContent}
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }}> {/* Container for link and button */}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#24A0ED', textDecoration: 'none', fontSize: '0.8rem' }}
            className="hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            View Source
          </a>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation(); // Prevent event bubbling to avoid tooltip disappearance
            handleCopy();
          }}
          style={{
            background: 'none',
            border: '1px solid #ccc',
            borderRadius: '3px',
            padding: '3px 6px',
            cursor: 'pointer',
            fontSize: '0.8rem',
            color: copied ? 'green' : '#555', // Change color on successful copy
          }}
          className="dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 hover:bg-gray-100"
          title="Copy citation content"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
};

export default CitationTooltip;