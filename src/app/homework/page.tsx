'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { 
  Bell, 
  ChevronDown, 
  PlusCircle,
} from 'lucide-react';
import { AIChatPanel } from '@/components/AIChatPanel';
import { ImportDocumentDialog } from '@/components/ImportDocumentDialog';
import {
  createActivationHandlerKey,
  RequirementReaderShell,
  useRequirementReader,
} from '@/components/prd/RequirementReaderShell';
import {
  requirementRegistries,
} from '@/requirements';

// 动态导入 UploadQuestionDialog，禁用 SSR（因为 react-pdf 使用了浏览器 API）
const UploadQuestionDialog = dynamic(
  () => import('@/components/UploadQuestionDialog').then(mod => ({ default: mod.UploadQuestionDialog })),
  { ssr: false }
);

// 作业数据
const homeworkList = [
  {
    id: 1,
    title: '2026年3月25日英语作业',
    class: '七年级(1)班',
    time: '2026-03-25 11:43 ~ 2026-03-26 11:43',
    status: '进行中',
    content: '乐课网全能拔高-书面表达之邀请信',
    aiGrading: true,
    submitCount: 1,
    totalCount: 3,
    aiGradeCount: 1,
    reGradeCount: 1,
    avgScore: 95.7,
  },
  {
    id: 2,
    title: '测试题目显示',
    class: '七年级(1)班',
    time: '2026-03-23 10:01 ~ 2026-03-24 10:01',
    status: '已结束',
    content: '测试题目显示',
    aiGrading: false,
    submitCount: 0,
    totalCount: 3,
  },
  {
    id: 3,
    title: '测试线上-教师批改',
    class: '七年级(1)班',
    time: '2026-03-20 10:43 ~ 2026-03-21 10:43',
    status: '已结束',
    content: '初中英语Get ready练习',
    aiGrading: false,
    submitCount: 1,
    totalCount: 3,
    gradeCount: 0,
    avgScore: null,
  },
];

export default function HomeworkPage() {
  return (
    <RequirementReaderShell registries={requirementRegistries}>
      <HomeworkPrototype />
    </RequirementReaderShell>
  );
}

function HomeworkPrototype() {
  const [activeTab, setActiveTab] = useState<'all' | 'pending'>('all');
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [subjectInfo, setSubjectInfo] = useState<string>('');
  const [fileRanges, setFileRanges] = useState<{ rangeStart: number; rangeEnd: number }[]>([]);
  const [fileTotalPages, setFileTotalPages] = useState<number[]>([]);
  const [, setSelectedQuestions] = useState<number[]>([]);
  const [, setCurrentStep] = useState<'idle' | 'upload' | 'subject' | 'select' | 'recognize' | 'edit'>('idle');
  const [isAppendUpload, setIsAppendUpload] = useState(false); // 是否为追加上传模式
  const [isSupplementUpload, setIsSupplementUpload] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<{ name: string }[] | null>(null);
  const requirementReader = useRequirementReader();

  // 检测是否需要恢复上传录题弹窗（从试卷编辑页返回时）
  useEffect(() => {
    const shouldReopen = sessionStorage.getItem('leke_upload_dialog_open');
    if (shouldReopen === 'true') {
      const timeoutId = window.setTimeout(() => setShowUploadDialog(true), 0);
      sessionStorage.removeItem('leke_upload_dialog_open');
      return () => window.clearTimeout(timeoutId);
    }
  }, []);

  useEffect(() => {
    if (!requirementReader) {
      return;
    }

    const cleanupHandlers = [
      requirementReader.registerActivationHandler(createActivationHandlerKey('openPanel', 'AIChatPanel'), () => {
        setShowAIPanel(true);
      }),
      requirementReader.registerActivationHandler(createActivationHandlerKey('openDialog', 'ImportDocumentDialog'), () => {
        setCurrentStep('upload');
        setShowImportDialog(true);
      }),
      requirementReader.registerActivationHandler(createActivationHandlerKey('openDialog', 'UploadQuestionDialog'), () => {
        setCurrentStep('select');
        setShowImportDialog(false);
        setShowUploadDialog(true);
      }),
    ];

    return () => cleanupHandlers.forEach((cleanup) => cleanup());
  }, [requirementReader]);

  const handleAIButtonClick = (action: string) => {
    if (action === '识别作业资料') {
      setCurrentStep('select');
      setShowUploadDialog(true);
    }
  };

  const handleFileUpload = (files: File[], subjInfo?: string, ranges?: { rangeStart: number; rangeEnd: number }[], totalPages?: number[]) => {
    if (isAppendUpload) {
      // 追加模式：将新文件添加到已有文件列表后面
      setUploadedFiles(prev => [...prev, ...files]);
      setFileRanges(prev => [...prev, ...(ranges || [])]);
      setFileTotalPages(prev => [...prev, ...(totalPages || [])]);
      setIsAppendUpload(false);
      // 标记：记录追加的文件数量和文件名，供子组件检测并弹出文件用途弹窗
      sessionStorage.setItem('leke_appended_count', String(files.length));
      sessionStorage.setItem('leke_appended_names', files.map(f => f.name).join('|'));
    } else {
      // 首次上传：替换文件列表
      setUploadedFiles(files);
      setFileRanges(ranges || []);
      setFileTotalPages(totalPages || []);
      setSubjectInfo(subjInfo || '');
      setShowImportDialog(false);
      // 直接打开上传录题弹窗
      setShowUploadDialog(true);
    }
    setShowImportDialog(false);
  };

  const handleContinueUpload = () => {
    // 设置追加模式，然后打开文件选择弹窗
    setIsAppendUpload(true);
    setIsSupplementUpload(false);
    setShowImportDialog(true);
  };

  const handleSupplementUpload = () => {
    // 补充资料模式：隐藏资源库tab，只显示本地上传
    setIsAppendUpload(true);
    setIsSupplementUpload(true);
    setShowImportDialog(true);
  };

  const handleReupload = () => {
    // 重新上传：清空已有文件，以替换模式打开文件选择弹窗
    setUploadedFiles([]);
    setIsAppendUpload(false);
    setShowImportDialog(true);
  };

  const handleDeleteFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
    setFileRanges(prev => prev.filter((_, i) => i !== index));
    setFileTotalPages(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateFileRange = (index: number, rangeStart: number, rangeEnd: number) => {
    setFileRanges(prev => prev.map((r, i) =>
      i === index ? { rangeStart, rangeEnd } : r
    ));
  };

  const handleQuestionSelect = (questions: number[]) => {
    setSelectedQuestions(questions);
    setCurrentStep('recognize');
  };

  const handleAddToPaper = () => {
    // 保存上传录题弹窗状态到 sessionStorage，以便「返回录题」时恢复
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('leke_upload_dialog_open', 'true');
    }
    setShowUploadDialog(false);
    setCurrentStep('edit');
    // 跳转到试卷编辑页面，可以携带题目数据
    window.location.href = '/paper-edit';
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* 顶部导航栏 */}
      <header className="bg-white shadow-sm">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="text-emerald-600 font-bold text-xl">乐课网</div>
            <div className="text-gray-400 text-sm">leke.cn</div>
            <span className="text-gray-400 text-sm ml-2">让教育简单又有效</span>
          </div>
          
          {/* 右侧 */}
          <div className="flex items-center gap-6">
            <button className="relative">
              <Bell className="w-5 h-5 text-gray-600" />
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                14
              </span>
            </button>
            <button className="flex items-center gap-1 text-gray-700">
              <span>黄英</span>
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        {/* 二级导航 */}
        <div className="bg-emerald-600">
          <div className="max-w-[1400px] mx-auto px-6 h-10 flex items-center gap-1">
            <button className="flex items-center gap-1 px-4 h-8 text-white hover:bg-emerald-700 rounded">
              <span className="text-sm">☰</span>
              <span className="text-sm">作业</span>
            </button>
            <button className="px-4 h-8 bg-emerald-700 text-white rounded text-sm">
              作业管理
            </button>
            <button className="px-4 h-8 text-white hover:bg-emerald-700 rounded text-sm">
              口语中心
            </button>
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        {/* 筛选栏 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button 
              className={`px-4 py-2 rounded text-sm ${activeTab === 'all' ? 'bg-emerald-500 text-white' : 'bg-white text-gray-600'}`}
              onClick={() => setActiveTab('all')}
            >
              全部(13)
            </button>
            <button 
              className={`px-4 py-2 rounded text-sm ${activeTab === 'pending' ? 'bg-emerald-500 text-white' : 'bg-white text-gray-600'}`}
              onClick={() => setActiveTab('pending')}
            >
              待批改(5)
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-4 py-2 bg-white rounded text-sm text-gray-600 flex items-center gap-1">
              <span>筛选</span>
              <ChevronDown className="w-4 h-4" />
            </button>
            <button className="px-4 py-2 bg-emerald-500 text-white rounded text-sm flex items-center gap-1">
              <PlusCircle className="w-4 h-4" />
              <span>布置作业</span>
            </button>
          </div>
        </div>

        {/* 作业列表 */}
        <div className="space-y-4">
          {homeworkList.map((homework) => (
            <div key={homework.id} className="bg-white rounded-lg p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-medium text-gray-800 mb-1">{homework.title}</h3>
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    <span>{homework.class}</span>
                    <span>{homework.time}</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      homework.status === '进行中' 
                        ? 'bg-green-100 text-green-600' 
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {homework.status}
                    </span>
                  </div>
                </div>
                <button className="text-gray-400 text-sm flex items-center gap-1">
                  <span>更多操作</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-600 mb-2">
                    {homework.content}
                    {homework.aiGrading && (
                      <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-600 text-xs rounded">
                        AI批改
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    <span>提交人数: {homework.submitCount}/{homework.totalCount}</span>
                    {homework.aiGrading && (
                      <>
                        <span>AI批改人数: {homework.aiGradeCount}/{homework.submitCount}</span>
                        <span>复批人数: {homework.reGradeCount}/{homework.aiGradeCount}</span>
                        <span>平均分: {homework.avgScore}</span>
                      </>
                    )}
                    {homework.gradeCount !== undefined && (
                      <>
                        <span>批改人数: {homework.gradeCount}/{homework.submitCount}</span>
                        <span>平均分: {homework.avgScore ?? '--'}</span>
                      </>
                    )}
                  </div>
                </div>
                {homework.status === '已结束' && !homework.aiGrading && homework.submitCount > 0 && (
                  <button className="px-4 py-2 bg-emerald-500 text-white rounded text-sm">
                    批改
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* AI小乐悬浮图标 */}
      {!showAIPanel && (
        <button
          type="button"
          onClick={() => setShowAIPanel(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full cursor-pointer"
          style={{ right: 'var(--prd-floating-right, 1.5rem)' }}
        >
          <span className="sr-only">打开AI小乐</span>
          <div className="relative w-full h-full">
            <div className="w-full h-full rounded-full overflow-hidden shadow-lg hover:ring-2 hover:ring-emerald-400 transition-all">
              <Image 
                src="/ai-mascot.jpg" 
                alt="AI小乐" 
                width={56} 
                height={56}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="absolute -top-10 right-0 bg-white rounded-lg shadow-lg px-3 py-2 whitespace-nowrap">
              <span className="text-sm text-gray-600">Hi, 我是AI小乐!</span>
              <div className="absolute bottom-0 right-4 w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white transform translate-y-full"></div>
            </div>
          </div>
        </button>
      )}

      {/* AI小乐侧边栏 */}
      {showAIPanel && (
        <AIChatPanel
          onClose={() => setShowAIPanel(false)}
          onActionClick={handleAIButtonClick}
          uploadedFile={uploadedFiles[0] || null}
          pendingFiles={pendingFiles}
        />
      )}

      {/* 导入文档弹窗 */}
      {showImportDialog && (
        <ImportDocumentDialog
          onClose={() => {
            setShowImportDialog(false);
            setIsAppendUpload(false);
            setIsSupplementUpload(false);
          }}
          onUpload={handleFileUpload}
          defaultSubject={subjectInfo}
          hideLibraryTab={isSupplementUpload}
          existingPageCount={fileRanges.reduce((sum, r) => sum + (r.rangeEnd - r.rangeStart + 1), 0)}
        />
      )}

      {/* 上传录题弹窗 */}
      {showUploadDialog && (
        <UploadQuestionDialog
          onClose={() => {
            setShowUploadDialog(false);
            if (uploadedFiles.length > 0) {
              setPendingFiles(uploadedFiles.map(f => ({ name: f.name })));
              setTimeout(() => setPendingFiles(null), 100);
            }
          }}
          onQuestionSelect={handleQuestionSelect}
          onAddToPaper={handleAddToPaper}
          uploadedFiles={uploadedFiles}
          subjectInfo={subjectInfo}
          fileRanges={fileRanges}
          onContinueUpload={handleContinueUpload}
          onSupplementUpload={handleSupplementUpload}
          onReupload={handleReupload}
          onDeleteFile={handleDeleteFile}
          onUpdateFileRange={handleUpdateFileRange}
          fileTotalPages={fileTotalPages}
          onUploadFiles={(files, subject, ranges, totalPages) => {
            setUploadedFiles(prev => [...prev, ...files]);
            setFileRanges(prev => [...prev, ...(ranges || [])]);
            setFileTotalPages(prev => [...prev, ...(totalPages || [])]);
            if (subject) setSubjectInfo(subject);
          }}
        />
      )}
    </div>
  );
}
