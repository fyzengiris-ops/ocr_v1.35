'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { X, CloudUpload, FileText, Trash2, Search, AlertCircle, Loader2, ChevronDown } from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import { cn } from '@/lib/utils';
import { RequirementMarker } from '@/components/prd/RequirementMarker';
import { createActivationHandlerKey, useRequirementReader } from '@/components/prd/RequirementReaderShell';
import { createRequirementMap } from '@/components/prd/requirement-utils';
import { importDocumentDialogRegistry } from '@/requirements';

interface ImportDocumentDialogProps {
  onClose: () => void;
  onUpload: (files: File[], subject?: string, fileRanges?: { rangeStart: number; rangeEnd: number }[]) => void;
  defaultSubject?: string; // 默认学段学科（继续上传时记住上次选择）
}

// 学段学科选项（合并）
const subjectOptions = [
  { value: '初中数学', label: '初中数学' },
  { value: '初中英语', label: '初中英语' },
  { value: '初中物理', label: '初中物理' },
];

// Mock资源库数据
const mockResources = [
  { id: 1, name: '2026年02月11日生物练习01', date: '2026-02-11', type: 'doc', totalPages: 27 },
  { id: 2, name: '2026年02月11日生物练习', date: '2026-02-11', type: 'doc', totalPages: 8 },
  { id: 3, name: '2025年12月21日生物练习', date: '2025-12-21', type: 'doc', totalPages: 15 },
  { id: 4, name: '2025年12月22日历史练习', date: '2025-12-22', type: 'doc', totalPages: 6 },
  { id: 5, name: '初中英语Get ready练习01', date: '2026-03-20', type: 'doc', totalPages: 12 },
];

const reviewLocalFileId = 'prd-review-local-file';

// 已上传文件接口
interface UploadedFile {
  id: string;
  file: File;
  totalPages: number | null; // null表示正在检测中
  isDetecting: boolean;
  rangeStart: number; // 用户选择的起始页码（1-based），默认1
  rangeEnd: number;   // 用户选择的结束页码，默认等于totalPages
}

// 多文件范围选择弹窗临时状态
interface MultiRangeState {
  show: boolean;
  // 每个文件的临时范围：fileId -> { start, end }
  tempRanges: Map<string, { start: number; end: number }>;
}

export function ImportDocumentDialog({ onClose, onUpload, defaultSubject }: ImportDocumentDialogProps) {
  const [activeTab, setActiveTab] = useState<'local' | 'library'>('local');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedResourceId, setSelectedResourceId] = useState<number | null>(null);
  const [multiRange, setMultiRange] = useState<MultiRangeState>({
    show: false,
    tempRanges: new Map(),
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 资源库范围选择状态
  const [libraryRange, setLibraryRange] = useState<{ start: number; end: number }>({ start: 1, end: 24 });
  const [showLibraryRangeDialog, setShowLibraryRangeDialog] = useState(false);
  
  // 学段学科选择状态
  const [selectedSubject, setSelectedSubject] = useState<string>(defaultSubject || '');
  const [showSubjectDropdown, setShowSubjectDropdown] = useState(false);

  const [validationError, setValidationError] = useState<string>('');
  const [selectedRequirementId, setSelectedRequirementId] = useState<string | null>(null);
  const requirementReader = useRequirementReader();
  const requirementsById = useMemo(
    () => createRequirementMap(importDocumentDialogRegistry.requirements),
    [],
  );

  const renderRequirementMarker = (
    requirementId: string,
    className: string,
    displayNumber: number,
  ) => {
    const requirement = requirementsById.get(requirementId);

    if (!requirement) {
      return null;
    }

    return (
      <RequirementMarker
        requirement={requirement}
        isOpen={selectedRequirementId === requirementId}
        displayNumber={displayNumber}
        className={className}
        onToggle={() =>
          setSelectedRequirementId((current) => (current === requirementId ? null : requirementId))
        }
        onClose={() => setSelectedRequirementId(null)}
      />
    );
  };

  // 真实检测文件页数
  const detectFilePages = async (file: File): Promise<number> => {
    const fileType = file.type.toLowerCase();
    const fileName = file.name.toLowerCase();
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.avif', '.heic', '.heif'];
    
    // 图片文件：页数为1
    if (fileType.startsWith('image/') || imageExtensions.some(ext => fileName.endsWith(ext))) {
      return 1;
    }
    
    // PDF文件：使用 pdf-lib 读取实际页数
    if (fileType.includes('pdf') || fileName.endsWith('.pdf')) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(arrayBuffer);
        return pdfDoc.getPageCount();
      } catch (error) {
        console.error('读取PDF页数失败:', error);
        return 1; // 读取失败时默认1页
      }
    }
    
    // DOC/DOCX文件：浏览器端无法直接读取，需要后端处理
    // 这里暂时返回1，实际应该调用后端API
    if (fileType.includes('doc') || fileType.includes('docx') || 
        fileName.endsWith('.doc') || fileName.endsWith('.docx')) {
      // 可以显示提示，但暂时返回1页
      return 1;
    }
    
    // 其他格式默认1页
    return 1;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    processFiles(files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    processFiles(files);
    // 重置input以便重复选择同一文件
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const processFiles = async (files: File[]) => {
    // 先添加文件到列表，标记为正在检测
    const newFiles: UploadedFile[] = files.map(file => ({
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      totalPages: null,
      isDetecting: true,
      rangeStart: 1,
      rangeEnd: 1,
    }));

    setUploadedFiles(prev => [...prev, ...newFiles]);

    // 异步检测每个文件的页数（不再自动弹窗）
    for (let i = 0; i < newFiles.length; i++) {
      const fileItem = newFiles[i];
      try {
        const totalPages = await detectFilePages(fileItem.file);

        setUploadedFiles(prev => prev.map(f =>
          f.id === fileItem.id
            ? { ...f, totalPages, isDetecting: false, rangeStart: 1, rangeEnd: totalPages }
            : f
        ));
      } catch (error) {
        console.error('检测文件页数失败:', error);
        setUploadedFiles(prev => prev.map(f =>
          f.id === fileItem.id
            ? { ...f, totalPages: 1, isDetecting: false, rangeStart: 1, rangeEnd: 1 }
            : f
        ));
      }
    }
  };

  const handleRemoveFile = (fileId: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  // 打开多文件范围选择弹窗，可选高亮某文件
  const [highlightedFileId, setHighlightedFileId] = useState<string | null>(null);

  const createReviewLocalFile = useCallback((): UploadedFile => {
    const file = new File(['PRD review file'], 'PRD示例作业资料.pdf', { type: 'application/pdf' });

    return {
      id: reviewLocalFileId,
      file,
      totalPages: 30,
      isDetecting: false,
      rangeStart: 1,
      rangeEnd: 30,
    };
  }, []);

  const ensureReviewLocalFile = useCallback(() => {
    setUploadedFiles((currentFiles) => {
      if (currentFiles.some((file) => !file.isDetecting && file.totalPages !== null)) {
        return currentFiles;
      }

      return [createReviewLocalFile()];
    });
  }, [createReviewLocalFile]);

  const handleOpenMultiRange = useCallback((highlightFileId?: string) => {
    const newTempRanges = new Map<string, { start: number; end: number }>();
    uploadedFiles.forEach(f => {
      if (f.totalPages !== null && !f.isDetecting) {
        newTempRanges.set(f.id, {
          start: f.rangeStart,
          end: f.rangeEnd,
        });
      }
    });
    setHighlightedFileId(highlightFileId || null);
    setMultiRange({ show: true, tempRanges: newTempRanges });
  }, [uploadedFiles]);

  useEffect(() => {
    if (!requirementReader) {
      return;
    }

    const cleanupHandlers = [
      requirementReader.registerActivationHandler(createActivationHandlerKey('setTab', 'local'), () => {
        setActiveTab('local');
        ensureReviewLocalFile();
      }),
      requirementReader.registerActivationHandler(createActivationHandlerKey('setTab', 'library'), () => {
        const overLimitResource = mockResources.find((resource) => resource.totalPages > 24);

        setActiveTab('library');

        if (overLimitResource) {
          setSelectedResourceId(overLimitResource.id);
          setLibraryRange({ start: 1, end: Math.min(24, overLimitResource.totalPages) });
        }
      }),
      requirementReader.registerActivationHandler(createActivationHandlerKey('openDialog', 'LocalRangeDialog'), () => {
        setActiveTab('local');
        const firstReadyFile = uploadedFiles.find((file) => !file.isDetecting && file.totalPages !== null);

        if (firstReadyFile) {
          handleOpenMultiRange(firstReadyFile.id);
          return;
        }

        const reviewFile = createReviewLocalFile();
        setUploadedFiles([reviewFile]);
        setHighlightedFileId(reviewFile.id);
        setMultiRange({
          show: true,
          tempRanges: new Map([[reviewFile.id, { start: reviewFile.rangeStart, end: reviewFile.rangeEnd }]]),
        });
      }),
      requirementReader.registerActivationHandler(createActivationHandlerKey('openDialog', 'LibraryRangeDialog'), () => {
        const overLimitResource = mockResources.find((resource) => resource.totalPages > 24);

        if (!overLimitResource) {
          return;
        }

        setActiveTab('library');
        setSelectedResourceId(overLimitResource.id);
        setLibraryRange({ start: 1, end: Math.min(24, overLimitResource.totalPages) });
        setShowLibraryRangeDialog(true);
      }),
    ];

    return () => cleanupHandlers.forEach((cleanup) => cleanup());
  }, [createReviewLocalFile, ensureReviewLocalFile, handleOpenMultiRange, requirementReader, uploadedFiles]);

  // 更新弹窗中某文件的临时范围
  const handleTempRangeChange = (fileId: string, field: 'start' | 'end', value: number) => {
    setMultiRange(prev => {
      const next = new Map(prev.tempRanges);
      const current = next.get(fileId) || { start: 1, end: 1 };
      if (field === 'start') {
        const file = uploadedFiles.find(f => f.id === fileId);
        const maxEnd = file?.totalPages || 1;
        next.set(fileId, { start: value, end: Math.max(value, current.end > maxEnd ? maxEnd : Math.min(current.end, maxEnd)) });
      } else {
        next.set(fileId, { ...current, end: value });
      }
      return { ...prev, tempRanges: next };
    });
  };

  // 计算弹窗中当前已选总页数
  const getMultiRangeTotal = () => {
    let total = 0;
    multiRange.tempRanges.forEach(({ start, end }) => {
      total += (end - start + 1);
    });
    return total;
  };

  // 确认多文件范围选择
  const handleMultiRangeConfirm = () => {
    setUploadedFiles(prev =>
      prev.map(f => {
        const tr = multiRange.tempRanges.get(f.id);
        if (tr) {
          return { ...f, rangeStart: tr.start, rangeEnd: tr.end };
        }
        return f;
      })
    );
    setMultiRange({ show: false, tempRanges: new Map() });
  };

  // 取消多文件范围选择
  const handleMultiRangeCancel = () => {
    setMultiRange({ show: false, tempRanges: new Map() });
    setHighlightedFileId(null);
  };

  // 计算当前文件列表已选总页数（使用已保存的 rangeStart/rangeEnd）
  const getCurrentSelectedTotal = () => {
    let total = 0;
    uploadedFiles.forEach(f => {
      if (!f.isDetecting && f.totalPages !== null) {
        total += (f.rangeEnd - f.rangeStart + 1);
      }
    });
    return total;
  };

  // 计算所有文件原始总页数
  const getTotalOriginalPages = () => {
    let total = 0;
    uploadedFiles.forEach(f => {
      if (f.totalPages !== null && !f.isDetecting) {
        total += f.totalPages;
      }
    });
    return total;
  };

  const handleConfirm = () => {
    setValidationError('');

    if (!selectedSubject) {
      setValidationError('请选择学科');
      return;
    }

    if (activeTab === 'local') {
      if (uploadedFiles.length === 0) {
        setValidationError('请上传资料');
        return;
      }

      const isDetecting = uploadedFiles.some(f => f.isDetecting);
      if (isDetecting) return;

      onUpload(
        uploadedFiles.map(f => f.file),
        selectedSubject,
        uploadedFiles.map(f => ({
          rangeStart: f.rangeStart,
          rangeEnd: f.rangeEnd,
        }))
      );
    } else if (activeTab === 'library') {
      if (!selectedResourceId) {
        setValidationError('请选择资料');
        return;
      }

      const selectedResource = mockResources.find(r => r.id === selectedResourceId);
      if (selectedResource) {
        const mockFile = new File([], selectedResource.name + '.doc', { type: 'application/msword' });
        const fileRanges = selectedResource.totalPages > 24
          ? [{ rangeStart: libraryRange.start, rangeEnd: libraryRange.end }]
          : undefined;
        onUpload([mockFile], selectedSubject, fileRanges);
      }
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0KB';
    return (bytes / 1024).toFixed(2) + 'KB';
  };

  const filteredResources = mockResources.filter(resource =>
    resource.name.toLowerCase().includes(searchKeyword.toLowerCase())
  );
  const firstVisibleWithinLimitResourceId = filteredResources.find(
    (resource) => resource.totalPages <= 24,
  )?.id;

  const totalOriginalPages = getTotalOriginalPages();
  const totalSelectedPages = getCurrentSelectedTotal();
  const isOverLimit = totalOriginalPages > 24;
  const isSelectedOverLimit = totalSelectedPages > 24;

  // 检查是否可以确认
  const canConfirm =
    selectedSubject &&
    ((activeTab === 'local' &&
      uploadedFiles.length > 0 &&
      !uploadedFiles.some(f => f.isDetecting) &&
      !isSelectedOverLimit) ||
    (activeTab === 'library' && selectedResourceId &&
      (() => {
        const res = mockResources.find(r => r.id === selectedResourceId);
        if (!res || res.totalPages <= 24) return true;
        return (libraryRange.end - libraryRange.start + 1) <= 24;
      })())
  );

  return (
    <div
      className="fixed inset-y-0 left-0 bg-black/50 z-[60] flex items-center justify-center"
      style={{ right: 'var(--prd-side-panel-right, 0px)' }}
    >
      <div
        data-req-anchor="import-document-dialog.container"
        className="relative bg-white rounded-lg w-[560px] max-w-[90vw]"
      >
        {renderRequirementMarker('IMPORT_DOCUMENT_DIALOG-001', 'right-10 top-3', 1)}
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-medium text-gray-800">识别作业资料</h3>
          <button onClick={onClose} className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-white hover:bg-emerald-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 标签切换 */}
        <div data-req-anchor="import-document-dialog.tabs" className="relative flex border-b bg-gray-50">
          {renderRequirementMarker('IMPORT_DOCUMENT_DIALOG-014', 'right-2 top-2', 14)}
          <button
            className={`flex-1 py-3 text-sm transition-colors ${
              activeTab === 'local'
                ? 'bg-white text-gray-700 border-b-2 border-gray-300'
                : 'text-gray-500'
            }`}
            onClick={() => setActiveTab('local')}
          >
            本地上传
          </button>
          <button
            className={`flex-1 py-3 text-sm transition-colors ${
              activeTab === 'library'
                ? 'bg-white text-gray-700 border-b-2 border-gray-300'
                : 'text-gray-500'
            }`}
            onClick={() => setActiveTab('library')}
          >
            我的资源库
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-6">
          {activeTab === 'local' && (
            <>
              {/* 上传区域 */}
              <div
                data-req-anchor="import-document-dialog.local.upload-zone"
                className={`relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer ${
                  isDragging ? 'border-emerald-500 bg-emerald-50' : 'border-gray-300'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                {renderRequirementMarker('IMPORT_DOCUMENT_DIALOG-002', 'right-2 top-2', 2)}
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.tiff,.tif,.svg,.avif,.heic,.heif,.pdf,.doc,.docx"
                  multiple
                  onChange={handleFileSelect}
                />
                <CloudUpload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-sm text-gray-600 mb-2">
                  文件拖拽到此处上传, 或点击添加
                </p>
                <p className="text-xs text-gray-400">
                  支持PNG/JPG/JPEG/、DOC/DOCX、PDF格式的文件，一次最多支持识别24页内容
                </p>
              </div>

              {/* 已上传文件列表 */}
              {uploadedFiles.length > 0 && (
                <div
                  data-req-anchor="import-document-dialog.local.file-list"
                  className="relative mt-4 space-y-2"
                >
                  {renderRequirementMarker('IMPORT_DOCUMENT_DIALOG-003', 'right-1 top-0', 3)}
                  {renderRequirementMarker('IMPORT_DOCUMENT_DIALOG-004', 'right-10 top-0', 4)}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">已上传文件（{uploadedFiles.length}个）</span>
                    {uploadedFiles.length > 1 && (
                      <button
                        onClick={() => setUploadedFiles([])}
                        className="text-xs text-red-500 hover:text-red-600"
                      >
                        清空全部
                      </button>
                    )}
                  </div>
                  <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                    {uploadedFiles.map((uploadedFile, fileIndex) => (
                      <div
                        key={uploadedFile.id}
                        className="flex items-center justify-between p-3 hover:bg-gray-50"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-10 h-10 bg-blue-100 rounded flex items-center justify-center flex-shrink-0">
                            <FileText className="w-5 h-5 text-blue-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm text-gray-700 truncate">{uploadedFile.file.name}</div>
                            <div
                              data-req-anchor={
                                fileIndex === 0
                                  ? 'import-document-dialog.local.page-detection'
                                  : undefined
                              }
                              className="text-xs text-gray-500 flex items-center gap-2"
                            >
                              <span>{formatFileSize(uploadedFile.file.size)}</span>
                              <span>·</span>
                              {uploadedFile.isDetecting ? (
                                <span className="text-blue-500 flex items-center gap-1">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  检测中...
                                </span>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenMultiRange(uploadedFile.id);
                                  }}
                                  className="text-xs text-blue-600 font-medium hover:text-blue-800 hover:underline cursor-pointer"
                                >
                                  识别{uploadedFile.rangeEnd - uploadedFile.rangeStart + 1}页 / 共{uploadedFile.totalPages}页
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveFile(uploadedFile.id);
                            }}
                            className="text-gray-400 hover:text-red-500"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 总页数超限警告（仅本地上传tab，仅当已选总页数也超限时显示） */}
              {!uploadedFiles.some(f => f.isDetecting) && uploadedFiles.length > 0 && isOverLimit && isSelectedOverLimit && (
                <div
                  data-req-anchor="import-document-dialog.local.page-limit-warning"
                  className="relative mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg"
                >
                  {renderRequirementMarker('IMPORT_DOCUMENT_DIALOG-005', 'right-2 top-2', 5)}
                  <p className="text-xs text-amber-700 flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span>检测到文件共{totalOriginalPages}页，最多支持识别24页，请删除部分文件或自定义选择文件识别范围后，再继续操作</span>
                  </p>
                  <div className="flex justify-center mt-2">
                    <button
                      onClick={() => handleOpenMultiRange()}
                      className="px-4 py-1.5 text-xs font-medium text-amber-700 border border-amber-400 rounded-lg hover:bg-amber-100 transition-colors"
                    >
                      选择识别范围
                    </button>
                  </div>
                </div>
              )}

              {/* 学段学科选择 */}
              <div
                data-req-anchor="import-document-dialog.subject"
                className="relative mt-4 flex items-center gap-2"
              >
                {renderRequirementMarker('IMPORT_DOCUMENT_DIALOG-007', 'right-0 -top-2', 7)}
                <span className="text-sm text-gray-600">学段学科<span className="text-red-500">*</span>：</span>
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowSubjectDropdown(!showSubjectDropdown);
                    }}
                    className={`flex items-center gap-1 px-3 py-1.5 border rounded text-sm hover:border-gray-400 min-w-[100px] justify-between ${
                      selectedSubject ? 'text-gray-700' : 'text-gray-400'
                    }`}
                  >
                    {selectedSubject || '请选择学科'}
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  </button>
                  {showSubjectDropdown && (
                    <div className="absolute top-full left-0 mt-1 bg-white border rounded shadow-lg z-[70] min-w-[120px] max-h-48 overflow-y-auto">
                      {subjectOptions.map((subject) => (
                        <button
                          key={subject.value}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSubject(subject.value);
                            setShowSubjectDropdown(false);
                          }}
                          className={`w-full px-3 py-2 text-sm text-left hover:bg-gray-50 ${
                            selectedSubject === subject.value ? 'text-emerald-600 bg-emerald-50' : 'text-gray-700'
                          }`}
                        >
                          {subject.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {activeTab === 'library' && (
            <div>
              {/* 标题和搜索 */}
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-medium text-gray-800">我的资源库</h4>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="请输入文档名称"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    className="w-48 px-3 py-1.5 pr-8 border rounded-lg text-sm focus:outline-none focus:border-emerald-500"
                  />
                  <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                </div>
              </div>

              {/* 资源列表 */}
              <div data-req-anchor="import-document-dialog.library.range-draft" className="relative">
                {renderRequirementMarker('IMPORT_DOCUMENT_DIALOG-013', 'right-11 top-2', 13)}
              <div
                data-req-anchor="import-document-dialog.library.list"
                className="relative border rounded-lg max-h-64 overflow-y-auto"
              >
                {renderRequirementMarker('IMPORT_DOCUMENT_DIALOG-008', 'right-2 top-2', 8)}
                {filteredResources.map((resource) => {
                  const isSelected = selectedResourceId === resource.id;
                  const isOverLimit = resource.totalPages > 24;
                  const rangeStart = isSelected && isOverLimit ? libraryRange.start : 1;
                  const rangeEnd = isSelected && isOverLimit ? libraryRange.end : resource.totalPages;
                  return (
                  <div
                    key={resource.id}
                    className={`flex items-center gap-3 p-3 border-b last:border-b-0 cursor-pointer hover:bg-gray-50 ${
                      isSelected ? 'bg-emerald-50' : ''
                    }`}
                    onClick={() => {
                      setSelectedResourceId(resource.id);
                      if (resource.totalPages > 24) {
                        setLibraryRange({ start: 1, end: Math.min(24, resource.totalPages) });
                      }
                    }}
                  >
                    {/* 单选按钮 */}
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        isSelected
                          ? 'border-emerald-500'
                          : 'border-gray-300'
                      }`}
                    >
                      {isSelected && (
                        <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                      )}
                    </div>

                    {/* 文档图标 */}
                    <div className="w-10 h-10 bg-blue-500 rounded flex items-center justify-center">
                      <span className="text-white text-xs font-medium">DOC</span>
                    </div>

                    {/* 文档信息 */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-700 truncate">{resource.name}</div>
                      <div className="text-xs text-gray-400 flex items-center gap-2">
                        <span>{resource.date}</span>
                        <span>·</span>
                        {isSelected && isOverLimit ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowLibraryRangeDialog(true);
                            }}
                            className="text-blue-600 font-medium hover:text-blue-800 hover:underline"
                          >
                            识别{rangeEnd - rangeStart + 1}页 / 共{resource.totalPages}页
                          </button>
                        ) : (
                          <span
                            data-req-anchor={
                              resource.id === firstVisibleWithinLimitResourceId
                                ? 'import-document-dialog.library.within-limit'
                                : undefined
                            }
                            className="relative inline-flex items-center"
                          >
                            {resource.id === firstVisibleWithinLimitResourceId &&
                              renderRequirementMarker('IMPORT_DOCUMENT_DIALOG-009', '-right-8 -top-2', 9)}
                            共{resource.totalPages}页
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
                })}

                {filteredResources.length === 0 && (
                  <div className="text-center py-8 text-gray-400">
                    暂无匹配的资源
                  </div>
                )}
              </div>
              </div>

              {/* 资源库-选中资源超限警告 */}
              {selectedResourceId && (() => {
                const res = mockResources.find(r => r.id === selectedResourceId);
                if (!res || res.totalPages <= 24) return null;
                const selectedPages = libraryRange.end - libraryRange.start + 1;
                const isOver = selectedPages > 24;
                return (
                  <div
                    data-req-anchor="import-document-dialog.library.over-limit-warning"
                    className="relative mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg"
                  >
                    {renderRequirementMarker('IMPORT_DOCUMENT_DIALOG-010', 'right-2 top-2', 10)}
                    <p className="text-xs text-amber-700 flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <span>该资料共{res.totalPages}页，最多支持识别24页，请选择需要识别的页码范围后，再继续操作</span>
                    </p>
                    <div className="flex justify-center mt-2">
                      <button
                        onClick={() => setShowLibraryRangeDialog(true)}
                        className="px-4 py-1.5 text-xs font-medium text-amber-700 border border-amber-400 rounded-lg hover:bg-amber-100 transition-colors"
                      >
                        选择识别范围
                      </button>
                    </div>
                    {isOver && (
                      <p className="text-xs text-red-500 text-center mt-1">
                        当前选择共{selectedPages}页，超出24页限制
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* 学段学科选择 */}
              <div
                data-req-anchor="import-document-dialog.subject"
                className="relative mt-4 flex items-center gap-2"
              >
                {renderRequirementMarker('IMPORT_DOCUMENT_DIALOG-007', 'right-0 -top-2', 7)}
                <span className="text-sm text-gray-600">学段学科<span className="text-red-500">*</span>：</span>
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowSubjectDropdown(!showSubjectDropdown);
                    }}
                    className={`flex items-center gap-1 px-3 py-1.5 border rounded text-sm hover:border-gray-400 min-w-[100px] justify-between ${
                      selectedSubject ? 'text-gray-700' : 'text-gray-400'
                    }`}
                  >
                    {selectedSubject || '请选择学科'}
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  </button>
                  {showSubjectDropdown && (
                    <div className="absolute top-full left-0 mt-1 bg-white border rounded shadow-lg z-[70] min-w-[120px] max-h-48 overflow-y-auto">
                      {subjectOptions.map((subject) => (
                        <button
                          key={subject.value}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSubject(subject.value);
                            setShowSubjectDropdown(false);
                          }}
                          className={`w-full px-3 py-2 text-sm text-left hover:bg-gray-50 ${
                            selectedSubject === subject.value ? 'text-emerald-600 bg-emerald-50' : 'text-gray-700'
                          }`}
                        >
                          {subject.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div
          data-req-anchor="import-document-dialog.submit-handoff"
          className="relative flex justify-end items-center gap-3 p-4 border-t"
        >
          {renderRequirementMarker('IMPORT_DOCUMENT_DIALOG-015', 'right-28 top-2', 15)}
          {renderRequirementMarker('IMPORT_DOCUMENT_DIALOG-016', 'right-3 top-2', 16)}
          {validationError && (
            <span className="text-sm text-red-500 flex items-center gap-1 mr-auto">
              <AlertCircle className="w-4 h-4" />
              {validationError}
            </span>
          )}
          <button
            onClick={onClose}
            className="px-6 py-2 border rounded text-gray-600 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            data-req-anchor="import-document-dialog.footer.confirm"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={`px-6 py-2 rounded text-white ${
              canConfirm
                ? 'bg-emerald-500 hover:bg-emerald-600'
                : 'bg-gray-300 cursor-not-allowed'
            }`}
          >
            确定
          </button>
        </div>
      </div>

      {/* 多文件范围选择弹窗 */}
      {multiRange.show && (() => {
        const rangeTotal = getMultiRangeTotal();
        const rangeOk = rangeTotal <= 24;
        return (
        <div
          className="fixed inset-y-0 left-0 bg-black/50 flex items-center justify-center z-[65]"
          style={{ right: 'var(--prd-side-panel-right, 0px)' }}
        >
          <div
            data-req-anchor="import-document-dialog.local.range-dialog"
            className="relative bg-white rounded-lg shadow-xl w-[520px] max-w-[90vw] max-h-[80vh] flex flex-col"
          >
            {renderRequirementMarker('IMPORT_DOCUMENT_DIALOG-006', 'right-10 top-3', 6)}
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-medium text-gray-800">选择识别范围</h3>
              <button onClick={handleMultiRangeCancel} className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-gray-100">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <p className="text-xs text-gray-500">选择每份文件需要识别的页码范围：</p>

              {(() => {
                const fileList = uploadedFiles
                  .filter(f => !f.isDetecting && f.totalPages !== null)
                  .map(f => ({ file: f, isHighlighted: f.id === highlightedFileId }));
                // 高亮文件排最前面
                fileList.sort((a, b) => (a.isHighlighted ? -1 : 0) - (b.isHighlighted ? -1 : 0));

                return fileList.map(({ file: f, isHighlighted }) => {
                  const tr = multiRange.tempRanges.get(f.id) || { start: 1, end: f.totalPages || 1 };
                  const selectedCount = tr.end - tr.start + 1;
                  return (
                    <div key={f.id} className={cn(
                      "p-3 rounded-lg border transition-all",
                      isHighlighted
                        ? "bg-blue-50 border-blue-300 ring-1 ring-blue-200"
                        : "bg-gray-50 border-transparent"
                    )}>
                      <div className="flex items-center gap-2 mb-2">
                        <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span className="text-sm text-gray-700 truncate">{f.file.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 flex-shrink-0">起始页~结束页：</span>
                        <select
                          value={tr.start}
                          onChange={(e) => handleTempRangeChange(f.id, 'start', Number(e.target.value))}
                          className="px-2 py-1 text-xs border rounded focus:outline-none focus:border-emerald-500"
                        >
                          {Array.from({ length: f.totalPages || 1 }, (_, i) => (
                            <option key={i + 1} value={i + 1}>第{i + 1}页</option>
                          ))}
                        </select>
                        <select
                          value={Math.min(tr.end, f.totalPages || 1)}
                          onChange={(e) => handleTempRangeChange(f.id, 'end', Number(e.target.value))}
                          className="px-2 py-1 text-xs border rounded focus:outline-none focus:border-emerald-500"
                        >
                          {Array.from({ length: (f.totalPages || 1) - tr.start + 1 }, (_, i) => {
                            const pageNum = tr.start + i;
                            return (
                              <option key={pageNum} value={pageNum}>第{pageNum}页</option>
                            );
                          })}
                        </select>
                        <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
                          识别{selectedCount}页 / 共{f.totalPages}页
                        </span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            <div className="border-t px-4 py-3 bg-gray-50 rounded-b-lg space-y-2">
              <p className={cn(
                "text-xs text-center font-medium",
                rangeOk ? "text-emerald-600" : "text-red-500"
              )}>
                当前已选择总页数：{rangeTotal} / 24{!rangeOk && '（超出限制）'}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={handleMultiRangeCancel}
                  className="px-4 py-2 text-sm border rounded text-gray-600 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={handleMultiRangeConfirm}
                  disabled={!rangeOk}
                  className={cn(
                    "px-4 py-2 text-sm rounded text-white",
                    rangeOk ? "bg-emerald-500 hover:bg-emerald-600" : "bg-gray-300 cursor-not-allowed"
                  )}
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* 资源库范围选择弹窗 */}
      {showLibraryRangeDialog && (() => {
        const selectedRes = mockResources.find(r => r.id === selectedResourceId);
        if (!selectedRes) return null;
        const selectedPages = libraryRange.end - libraryRange.start + 1;
        const rangeOk = selectedPages <= 24;
        return (
        <div
          className="fixed inset-y-0 left-0 bg-black/50 flex items-center justify-center z-[65]"
          style={{ right: 'var(--prd-side-panel-right, 0px)' }}
        >
          <div
            data-req-anchor="import-document-dialog.library.range-dialog"
            className="relative bg-white rounded-lg shadow-xl w-[460px] max-w-[90vw]"
          >
            {renderRequirementMarker('IMPORT_DOCUMENT_DIALOG-011', 'right-10 top-3', 11)}
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-medium text-gray-800">选择识别范围</h3>
              <button onClick={() => setShowLibraryRangeDialog(false)} className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-gray-100">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-500">选择需要识别的页码范围：</p>

              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-sm text-gray-700 truncate">{selectedRes.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 flex-shrink-0">起始页~结束页：</span>
                  <select
                    value={libraryRange.start}
                    onChange={(e) => {
                      const start = Number(e.target.value);
                      setLibraryRange(prev => ({ start, end: Math.max(start, Math.min(prev.end, start + 23)) }));
                    }}
                    className="px-2 py-1 text-xs border rounded focus:outline-none focus:border-emerald-500"
                  >
                    {Array.from({ length: selectedRes.totalPages }, (_, i) => (
                      <option key={i + 1} value={i + 1}>第{i + 1}页</option>
                    ))}
                  </select>
                  <select
                    value={libraryRange.end}
                    onChange={(e) => setLibraryRange(prev => ({ ...prev, end: Number(e.target.value) }))}
                    className="px-2 py-1 text-xs border rounded focus:outline-none focus:border-emerald-500"
                  >
                    {Array.from({ length: Math.min(24, selectedRes.totalPages - libraryRange.start + 1) }, (_, i) => {
                      const pageNum = libraryRange.start + i;
                      return <option key={pageNum} value={pageNum}>第{pageNum}页</option>;
                    })}
                  </select>
                  <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
                    识别{selectedPages}页 / 共{selectedRes.totalPages}页
                  </span>
                </div>
              </div>
            </div>

            <div className="border-t px-4 py-3 bg-gray-50 rounded-b-lg space-y-2">
              <p className={cn(
                "text-xs text-center font-medium",
                rangeOk ? "text-emerald-600" : "text-red-500"
              )}>
                当前已选择总页数：{selectedPages} / 24{!rangeOk && '（超出限制）'}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowLibraryRangeDialog(false)}
                  className="px-4 py-2 text-sm border rounded text-gray-600 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={() => setShowLibraryRangeDialog(false)}
                  disabled={!rangeOk}
                  className={cn(
                    "px-4 py-2 text-sm rounded text-white",
                    rangeOk ? "bg-emerald-500 hover:bg-emerald-600" : "bg-gray-300 cursor-not-allowed"
                  )}
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
