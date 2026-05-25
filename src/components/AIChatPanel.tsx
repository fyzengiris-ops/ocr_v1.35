'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { 
  X, 
  Send, 
  Upload
} from 'lucide-react';

interface AIChatPanelProps {
  onClose: () => void;
  onActionClick: (action: string) => void;
  uploadedFile: File | null;
}

interface Message {
  id: number;
  type: 'ai' | 'user';
  content: string;
  file?: {
    name: string;
    size: string;
  };
}

export function AIChatPanel({ 
  onClose, 
  onActionClick, 
  uploadedFile
}: AIChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      type: 'ai',
      content: 'Hi! 我是AI小乐! 我能够帮您出题、布置作业, 请把您的任务交给我吧!',
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const quickActions = [
    { id: '布置试卷作业', label: '帮我布置试卷作业' },
    { id: '识别作业资料', label: '帮我识别作业资料' },
    { id: '布置听力作业', label: '帮我布置听力作业' },
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    // 当上传文件后，添加用户消息
    if (uploadedFile && !messages.find(m => m.file)) {
      setMessages(prev => [
        ...prev,
        {
          id: prev.length + 1,
          type: 'user',
          content: '帮我识别以下资料',
          file: {
            name: uploadedFile.name,
            size: `${(uploadedFile.size / 1024).toFixed(2)}KB`,
          },
        },
        {
          id: prev.length + 2,
          type: 'ai',
          content: '好的，接下来我将为您识别文档资料，并为您转换成在线试卷',
        },
      ]);
    }
  }, [uploadedFile]);

  const handleQuickAction = (action: string) => {
    setActiveAction(action);
    
    // 添加用户消息
    setMessages(prev => [
      ...prev,
      {
        id: prev.length + 1,
        type: 'user',
        content: `帮我${action}`,
      },
    ]);

    // 添加AI回复
    setTimeout(() => {
      if (action === '识别作业资料') {
        setMessages(prev => [
          ...prev,
          {
            id: prev.length + 1,
            type: 'ai',
            content: '好的, 请上传识别资料。支持的文件格式: PNG/JPG/JPEG/GIF/WebP/BMP、DOC/DOCX、PDF。',
          },
        ]);
        onActionClick(action);
      } else {
        setMessages(prev => [
          ...prev,
          {
            id: prev.length + 1,
            type: 'ai',
            content: '功能开发中，敬请期待...',
          },
        ]);
      }
    }, 500);
  };

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl z-50 flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between p-4 border-b">
        <h3 className="font-medium text-gray-800">AI小乐</h3>
        <div className="flex items-center gap-2">
          <button className="text-gray-500 text-sm hover:text-gray-700">历史对话</button>
          <button className="text-gray-500 text-sm hover:text-gray-700">新对话</button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div key={message.id} className={`${message.type === 'user' ? 'flex justify-end' : ''}`}>
            <div className={`${message.type === 'user' ? 'max-w-[80%]' : 'w-full'}`}>
              {message.type === 'ai' && (
                <div className="flex items-start gap-2">
                  <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
                    <Image 
                      src="/ai-mascot.jpg" 
                      alt="AI小乐" 
                      width={32} 
                      height={32}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1">
                    <div className="bg-gray-100 rounded-lg p-3 text-sm text-gray-700">
                      {message.content}
                    </div>
                  </div>
                </div>
              )}
              
              {message.type === 'user' && (
                <div>
                  <div className="bg-emerald-500 text-white rounded-lg p-3 text-sm">
                    {message.content}
                  </div>
                  {message.file && (
                    <div className="mt-2 bg-gray-100 rounded-lg p-2 flex items-center gap-2">
                      <div className="w-8 h-8 bg-blue-100 rounded flex items-center justify-center">
                        <Upload className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-700 truncate">{message.file.name}</div>
                        <div className="text-xs text-gray-500">{message.file.size}</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />

        {/* 快捷功能按钮 */}
        {messages.length === 1 && (
          <div className="space-y-2 flex flex-col items-start pl-10">
            {quickActions.map((action) => (
              <button
                key={action.id}
                onClick={() => handleQuickAction(action.id)}
                className={`py-2 px-4 rounded-lg text-sm transition-colors border ${
                  activeAction === action.id
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 输入区域 - 已禁用 */}
      <div className="border-t p-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="请使用快捷功能按钮操作"
            disabled
            className="flex-1 px-3 py-2 border rounded-lg text-sm bg-gray-100 text-gray-400 cursor-not-allowed"
          />
          <button className="w-10 h-10 bg-gray-300 rounded-lg flex items-center justify-center text-gray-500 cursor-not-allowed" disabled>
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
