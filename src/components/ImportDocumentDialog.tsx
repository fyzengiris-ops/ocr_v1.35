'use client';

import { useState, useRef } from 'react';
import { X, CloudUpload, FileText, Trash2, Search, AlertCircle, Check, Loader2, ChevronDown } from 'lucide-react';
import { PDFDocument } from 'pdf-lib';

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
  { id: 1, name: '2026年02月11日生物练习01', date: '2026-02-11', type: 'doc' },
  { id: 2, name: '2026年02月11日生物练习', date: '2026-02-11', type: 'doc' },
  { id: 3, name: '2025年12月21日生物练习', date: '2025-12-21', type: 'doc' },
  { id: 4, name: '2025年12月22日历史练习', date: '2025-12-22', type: 'doc' },
  { id: 5, name: '初中英语Get ready练习01', date: '2026-03-20', type: 'doc' },
];

// 已上传文件接口
interface UploadedFile {
  id: string;
  file: File;
  totalPages: number | null; // null表示正在检测中
  needsRangeSelect: boolean;
  isDetecting: boolean;
  rangeStart?: number; // 用户选择的起始页码（1-based）
  rangeEnd?: number;   // 用户选择的结束页码
}

// 范围选择器状态
interface RangeSelectorState {
  show: boolean;
  fileId: string | null;
  fileName: string;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
  rangeMode: 'first' | 'last' | 'custom';
}

export function ImportDocumentDialog({ onClose, onUpload, defaultSubject }: ImportDocumentDialogProps) {
  const [activeTab, setActiveTab] = useState<'local' | 'library'>('local');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedResourceId, setSelectedResourceId] = useState<number | null>(null);
  const [rangeSelector, setRangeSelector] = useState<RangeSelectorState>({
    show: false,
    fileId: null,
    fileName: '',
    totalPages: 0,
    rangeStart: 1,
    rangeEnd: 24,
    rangeMode: 'first',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // 学段学科选择状态
  const [selectedSubject, setSelectedSubject] = useState<string>(defaultSubject || '');
  const [showSubjectDropdown, setShowSubjectDropdown] = useState(false);

  const [validationError, setValidationError] = useState<string>('');

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
      needsRangeSelect: false,
      isDetecting: true,
    }));

    setUploadedFiles(prev => [...prev, ...newFiles]);

    // 异步检测每个文件的页数
    for (let i = 0; i < newFiles.length; i++) {
      const fileItem = newFiles[i];
      try {
        const totalPages = await detectFilePages(fileItem.file);
        
        // 更新文件信息
        setUploadedFiles(prev => {
          const updated = prev.map(f => 
            f.id === fileItem.id
              ? { 
                  ...f, 
                  totalPages, 
                  isDetecting: false,
                  needsRangeSelect: totalPages > 24 
                }
              : f
          );
          
          // 检查是否有超过24页的文件，需要弹出范围选择器
          const overLimitFile = updated.find(f => f.totalPages !== null && f.totalPages > 24 && f.needsRangeSelect);
          if (overLimitFile && overLimitFile.totalPages !== null) {
            setRangeSelector({
              show: true,
              fileId: overLimitFile.id,
              fileName: overLimitFile.file.name,
              totalPages: overLimitFile.totalPages,
              rangeStart: 1,
              rangeEnd: Math.min(24, overLimitFile.totalPages),
              rangeMode: 'first',
            });
          }
          
          return updated;
        });
      } catch (error) {
        console.error('检测文件页数失败:', error);
        // 检测失败时设置为1页
        setUploadedFiles(prev => prev.map(f => 
          f.id === fileItem.id
            ? { ...f, totalPages: 1, isDetecting: false, needsRangeSelect: false }
            : f
        ));
      }
    }
  };

  const handleRemoveFile = (fileId: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const handleQuickRange = (type: 'first' | 'last' | 'custom') => {
    const { totalPages } = rangeSelector;
    if (type === 'first') {
      setRangeSelector(prev => ({ ...prev, rangeStart: 1, rangeEnd: Math.min(24, totalPages), rangeMode: 'first' }));
    } else if (type === 'last') {
      setRangeSelector(prev => ({
        ...prev,
        rangeStart: Math.max(1, totalPages - 23),
        rangeEnd: totalPages,
        rangeMode: 'last',
      }));
    } else {
      // custom - 只切换模式，不改变范围
      setRangeSelector(prev => ({ ...prev, rangeMode: 'custom' }));
    }
  };

  const handleRangeConfirm = () => {
    // 确认范围选择，标记该文件，同时保存用户选择的页码范围
    setUploadedFiles(prev =>
      prev.map(f =>
        f.id === rangeSelector.fileId
          ? { ...f, needsRangeSelect: false, rangeStart: rangeSelector.rangeStart, rangeEnd: rangeSelector.rangeEnd }
          : f
      )
    );
    setRangeSelector(prev => ({ ...prev, show: false }));
  };

  const handleConfirm = () => {
    // 清除之前的错误
    setValidationError('');
    
    // 校验学科选择
    if (!selectedSubject) {
      setValidationError('请选择学科');
      return;
    }
    
    if (activeTab === 'local') {
      // 校验文件上传
      if (uploadedFiles.length === 0) {
        setValidationError('请上传资料');
        return;
      }
      
      // 检查是否还有正在检测或需要选择范围的文件
      const isDetecting = uploadedFiles.some(f => f.isDetecting);
      const needsSelect = uploadedFiles.some(f => f.totalPages !== null && f.totalPages > 24 && f.needsRangeSelect);
      
      if (isDetecting || needsSelect) {
        return;
      }
      
      onUpload(
        uploadedFiles.map(f => f.file),
        selectedSubject,
        uploadedFiles.map(f => ({
          rangeStart: f.rangeStart ?? 1,
          rangeEnd: f.rangeEnd ?? (f.totalPages ?? 1),
        }))
      );
    } else if (activeTab === 'library') {
      // 校验资源选择
      if (!selectedResourceId) {
        setValidationError('请选择资料');
        return;
      }
      
      // 模拟从资源库选择文件
      const selectedResource = mockResources.find(r => r.id === selectedResourceId);
      if (selectedResource) {
        const mockFile = new File([], selectedResource.name + '.doc', { type: 'application/msword' });
        onUpload([mockFile], selectedSubject);
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

  // 检查是否可以确认
  const canConfirm = 
    selectedSubject &&
    ((activeTab === 'local' && 
      uploadedFiles.length > 0 && 
      !uploadedFiles.some(f => f.isDetecting) &&
      !uploadedFiles.some(f => f.totalPages !== null && f.totalPages > 24 && f.needsRangeSelect)) ||
    (activeTab === 'library' && selectedResourceId));

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center">
      <div className="bg-white rounded-lg w-[560px] max-w-[90vw]">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-medium text-gray-800">识别作业资料</h3>
          <button onClick={onClose} className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-white hover:bg-emerald-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 标签切换 */}
        <div className="flex border-b bg-gray-50">
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
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer ${
                  isDragging ? 'border-emerald-500 bg-emerald-50' : 'border-gray-300'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
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
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">已上传的文件（{uploadedFiles.length}个）</span>
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
                    {uploadedFiles.map((uploadedFile) => (
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
                            <div className="text-xs text-gray-500 flex items-center gap-2">
                              <span>{formatFileSize(uploadedFile.file.size)}</span>
                              <span>·</span>
                              {uploadedFile.isDetecting ? (
                                <span className="text-blue-500 flex items-center gap-1">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  检测中...
                                </span>
                              ) : (
                                <>
                                  <span>{uploadedFile.totalPages}页</span>
                                  {uploadedFile.totalPages !== null && uploadedFile.totalPages > 24 && uploadedFile.needsRangeSelect && (
                                    <span className="text-orange-500 flex items-center gap-1">
                                      <AlertCircle className="w-3 h-3" />
                                      需选择范围
                                    </span>
                                  )}
                                  {uploadedFile.totalPages !== null && uploadedFile.totalPages > 24 && !uploadedFile.needsRangeSelect && (
                                    <span className="text-green-500 flex items-center gap-1">
                                      <Check className="w-3 h-3" />
                                      范围已选
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!uploadedFile.isDetecting && uploadedFile.totalPages !== null && uploadedFile.totalPages > 24 && uploadedFile.needsRangeSelect && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setRangeSelector({
                                  show: true,
                                  fileId: uploadedFile.id,
                                  fileName: uploadedFile.file.name,
                                  totalPages: uploadedFile.totalPages!, // 已通过条件判断确保不为null
                                  rangeStart: 1,
                                  rangeEnd: Math.min(24, uploadedFile.totalPages!),
                                  rangeMode: 'first',
                                });
                              }}
                              className="px-2 py-1 text-xs text-emerald-600 border border-emerald-500 rounded hover:bg-emerald-50"
                            >
                              选择范围
                            </button>
                          )}
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

              {/* 学段学科选择 */}
              <div className="mt-4 flex items-center gap-2">
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
              <div className="border rounded-lg max-h-64 overflow-y-auto">
                {filteredResources.map((resource) => (
                  <div
                    key={resource.id}
                    className={`flex items-center gap-3 p-3 border-b last:border-b-0 cursor-pointer hover:bg-gray-50 ${
                      selectedResourceId === resource.id ? 'bg-emerald-50' : ''
                    }`}
                    onClick={() => setSelectedResourceId(resource.id)}
                  >
                    {/* 单选按钮 */}
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        selectedResourceId === resource.id
                          ? 'border-emerald-500'
                          : 'border-gray-300'
                      }`}
                    >
                      {selectedResourceId === resource.id && (
                        <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                      )}
                    </div>

                    {/* 文档图标 */}
                    <div className="w-10 h-10 bg-blue-500 rounded flex items-center justify-center">
                      <span className="text-white text-xs font-medium">DOC</span>
                    </div>

                    {/* 文档信息 */}
                    <div className="flex-1">
                      <div className="text-sm text-gray-700">{resource.name}</div>
                      <div className="text-xs text-gray-400">{resource.date}</div>
                    </div>
                  </div>
                ))}

                {filteredResources.length === 0 && (
                  <div className="text-center py-8 text-gray-400">
                    暂无匹配的资源
                  </div>
                )}
              </div>

              {/* 学段学科选择 */}
              <div className="mt-4 flex items-center gap-2">
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
        <div className="flex justify-end items-center gap-3 p-4 border-t">
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

      {/* 范围选择器弹窗 */}
      {rangeSelector.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl w-[480px] max-w-[90vw]">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-2">选择识别范围</h3>
              <p className="text-sm text-gray-500 mb-4">
                文件：<span className="font-medium text-gray-700">{rangeSelector.fileName}</span>
              </p>
              <p className="text-sm text-gray-700 mb-3">
                资料总页数：共 <span className="font-medium">{rangeSelector.totalPages}</span> 页
              </p>
              <p className="text-sm text-gray-500 mb-4">
                系统单次最多识别24页，请选择需要识别的页数范围
              </p>
              
              {/* 快捷选项 */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => handleQuickRange('first')}
                  className={`px-4 py-1.5 text-sm border rounded hover:bg-gray-50 ${
                    rangeSelector.rangeMode === 'first' ? 'border-emerald-500 text-emerald-600 bg-emerald-50' : ''
                  }`}
                >
                  前24页
                </button>
                <button
                  onClick={() => handleQuickRange('last')}
                  className={`px-4 py-1.5 text-sm border rounded hover:bg-gray-50 ${
                    rangeSelector.rangeMode === 'last' ? 'border-emerald-500 text-emerald-600 bg-emerald-50' : ''
                  }`}
                >
                  后24页
                </button>
                <button
                  onClick={() => handleQuickRange('custom')}
                  className={`px-4 py-1.5 text-sm border rounded hover:bg-gray-50 ${
                    rangeSelector.rangeMode === 'custom' ? 'border-emerald-500 text-emerald-600 bg-emerald-50' : ''
                  }`}
                >
                  自定义
                </button>
              </div>
              
              {/* 范围选择 */}
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="text-xs text-gray-500">起始页</label>
                  <select
                    value={rangeSelector.rangeStart}
                    onChange={(e) => {
                      const start = Number(e.target.value);
                      const maxEnd = Math.min(start + 23, rangeSelector.totalPages);
                      setRangeSelector(prev => ({
                        ...prev,
                        rangeStart: start,
                        rangeEnd: maxEnd,
                        rangeMode: 'custom',
                      }));
                    }}
                    className="w-full mt-1 px-3 py-2 border rounded text-sm focus:outline-none focus:border-emerald-500"
                  >
                    {Array.from({ length: rangeSelector.totalPages }, (_, i) => (
                      <option key={i + 1} value={i + 1}>第 {i + 1} 页</option>
                    ))}
                  </select>
                </div>
                <span className="mt-5 text-gray-500">至</span>
                <div className="flex-1">
                  <label className="text-xs text-gray-500">结束页</label>
                  <select
                    value={rangeSelector.rangeEnd}
                    onChange={(e) => setRangeSelector(prev => ({ ...prev, rangeEnd: Number(e.target.value), rangeMode: 'custom' }))}
                    className="w-full mt-1 px-3 py-2 border rounded text-sm focus:outline-none focus:border-emerald-500"
                  >
                    {Array.from({ length: Math.min(24, rangeSelector.totalPages - rangeSelector.rangeStart + 1) }, (_, i) => {
                      const pageNum = rangeSelector.rangeStart + i;
                      return (
                        <option key={pageNum} value={pageNum}>第 {pageNum} 页</option>
                      );
                    })}
                  </select>
                </div>
              </div>
              
              <p className="text-sm text-gray-500 mt-3">
                已选择 <span className="font-medium text-emerald-600">{rangeSelector.rangeEnd - rangeSelector.rangeStart + 1}</span> 页
              </p>
            </div>
            
            <div className="flex justify-end gap-2 px-6 py-4 border-t bg-gray-50 rounded-b-lg">
              <button
                onClick={() => {
                  // 取消时删除该文件
                  if (rangeSelector.fileId) {
                    setUploadedFiles(prev => prev.filter(f => f.id !== rangeSelector.fileId));
                  }
                  setRangeSelector(prev => ({ ...prev, show: false }));
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                取消
              </button>
              <button
                onClick={handleRangeConfirm}
                className="px-4 py-2 text-sm bg-emerald-500 text-white rounded hover:bg-emerald-600"
              >
                确认识别
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
