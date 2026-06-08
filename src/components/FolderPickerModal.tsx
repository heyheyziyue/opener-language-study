import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { getAllFolders, saveFolder, generateId } from "../lib/storage";
import type { Folder } from "../lib/types";
import "./FolderPickerModal.css";

interface FolderPickerModalProps {
  /** 当前选中文件夹 ID（null = 全部，仅 showAllOption=true 时；undefined = 未分类；string = 文件夹 ID） */
  selectedFolderId: string | null | undefined;
  /** 是否显示"全部"选项（用于听写页面的过滤器；false 时不显示，selectedFolderId 也不接受 null） */
  showAllOption?: boolean;
  /** 是否为"仅创建"模式：只显示新建文件夹输入框，无单选列表，无"全部/未分类"选项。
   *  true 时 onConfirm 只可能收到新建文件夹的 ID（string），不会收到 null/undefined */
  createOnly?: boolean;
  /** 关闭弹窗（点击遮罩 / 取消按钮） */
  onClose: () => void;
  /** 用户点击"确定"：null = 全部；undefined = 未分类；string = 已有或新建文件夹 ID */
  onConfirm: (folderId: string | null | undefined) => void;
}

export default function FolderPickerModal({
  selectedFolderId,
  showAllOption = false,
  createOnly = false,
  onClose,
  onConfirm,
}: FolderPickerModalProps) {
  const [folders, setFolders] = useState<Folder[]>([]);
  // 内部用 null 表示"全部"（仅在 showAllOption=true 时使用），undefined 表示"未分类"
  const [draftId, setDraftId] = useState<string | null | undefined>(selectedFolderId);
  const [isCreating, setIsCreating] = useState(createOnly);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await getAllFolders();
      if (!cancelled) {
        // 按创建时间正序排，旧文件夹在上
        setFolders(all.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 进入创建态时自动 focus 输入框
  useEffect(() => {
    if (isCreating) {
      // 等下一帧再 focus，确保 input 已挂载
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isCreating]);

  const handleConfirm = async () => {
    if (isCreating) {
      const name = newName.trim();
      if (!name) {
        setError("请输入文件夹名称");
        return;
      }
      try {
        const folder: Folder = {
          id: generateId(),
          name,
          createdAt: new Date().toISOString(),
        };
        await saveFolder(folder);
        onConfirm(folder.id);
      } catch (e) {
        setError("创建失败，请重试");
      }
    } else {
      onConfirm(draftId);
    }
  };

  return (
    <motion.div
      className="folder-picker-modal"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="folder-picker-sheet"
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        exit={{ y: 100 }}
        onClick={(e) => e.stopPropagation()}
      >
          <div className="folder-picker-title">{createOnly ? "新建收藏夹" : "选择文件夹"}</div>

          {!createOnly && (
            <div className="folder-picker-list">
              {showAllOption && (
                <button
                  className={`folder-picker-item ${draftId === null && !isCreating ? "selected" : ""}`}
                  onClick={() => {
                    setDraftId(null);
                    setIsCreating(false);
                  }}
                >
                  <span className="folder-picker-radio">
                    {draftId === null && !isCreating ? "●" : "○"}
                  </span>
                  <span className="folder-picker-name">全部</span>
                </button>
              )}

              <button
                className={`folder-picker-item ${draftId === undefined && !isCreating ? "selected" : ""}`}
                onClick={() => {
                  setDraftId(undefined);
                  setIsCreating(false);
                }}
              >
                <span className="folder-picker-radio">
                  {draftId === undefined && !isCreating ? "●" : "○"}
                </span>
                <span className="folder-picker-name">未分类</span>
              </button>

              {folders.map((f) => (
                <button
                  key={f.id}
                  className={`folder-picker-item ${draftId === f.id && !isCreating ? "selected" : ""}`}
                  onClick={() => {
                    setDraftId(f.id);
                    setIsCreating(false);
                  }}
                >
                  <span className="folder-picker-radio">
                    {draftId === f.id && !isCreating ? "●" : "○"}
                  </span>
                  <span className="folder-picker-name">{f.name}</span>
                </button>
              ))}

              {isCreating ? (
                <div className="folder-picker-create-form">
                  <span className="folder-picker-radio selected">●</span>
                  <input
                    ref={inputRef}
                    className="folder-picker-input"
                    type="text"
                    placeholder="新文件夹名称"
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      setError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleConfirm();
                      if (e.key === "Escape") {
                        setIsCreating(false);
                        setNewName("");
                        setError(null);
                      }
                    }}
                    maxLength={20}
                  />
                </div>
              ) : (
                <button
                  className="folder-picker-item folder-picker-create"
                  onClick={() => {
                    setIsCreating(true);
                    setNewName("");
                    setError(null);
                  }}
                >
                  <span className="folder-picker-radio plus">+</span>
                  <span className="folder-picker-name">新建文件夹</span>
                </button>
              )}
            </div>
          )}

          {createOnly && (
            <div className="folder-picker-create-form folder-picker-create-only">
              <input
                ref={inputRef}
                className="folder-picker-input"
                type="text"
                placeholder="收藏夹名称"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConfirm();
                  if (e.key === "Escape") {
                    setNewName("");
                    setError(null);
                    onClose();
                  }
                }}
                maxLength={20}
              />
            </div>
          )}

          {error && <div className="folder-picker-error">{error}</div>}

          <div className="folder-picker-actions">
            <button
              className="btn-text"
              onClick={() => {
                setIsCreating(false);
                setNewName("");
                setError(null);
                onClose();
              }}
            >
              取消
            </button>
            <button className="btn-text active" onClick={handleConfirm}>
              确定
            </button>
          </div>
        </motion.div>
      </motion.div>
  );
}
