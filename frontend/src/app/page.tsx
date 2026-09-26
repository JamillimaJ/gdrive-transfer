"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

interface FileItem {
  id: string;
  name: string;
  type: string;
  owner?: string;
}

interface Account {
  id: number;
  name: string;
  email: string;
}

interface HistoryItem {
  id: string;
  name: string;
}

interface TransferPayload {
  sourceAccountId: number;
  destAccountId: number;
  fileId: string;
  destFolderId: string;
}

interface ActiveTransfer {
  taskId: string;
  fileName: string;
  progress: number;
  status: string;
  payload: TransferPayload;
  timestamp: number;
}

export default function Home() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [leftAccount, setLeftAccount] = useState<number | null>(null);
  const [rightAccount, setRightAccount] = useState<number | null>(null);
  
  // Navigation State
  const [leftHistory, setLeftHistory] = useState<HistoryItem[]>([{id: "root", name: "Root Directory"}]);
  const [rightHistory, setRightHistory] = useState<HistoryItem[]>([{id: "root", name: "Root Directory"}]);
  const [prevRightAccount, setPrevRightAccount] = useState<number | null>(null);
  
  // Selection State
  const [leftSelected, setLeftSelected] = useState<Set<string>>(new Set());
  const [rightSelected, setRightSelected] = useState<Set<string>>(new Set());
  
  // Files Data State
  const [leftFiles, setLeftFiles] = useState<FileItem[]>([]);
  const [rightFiles, setRightFiles] = useState<FileItem[]>([]);
  
  // Global Publishers State
  const [globalLeftPublishers, setGlobalLeftPublishers] = useState<string[]>([]);
  const [globalRightPublishers, setGlobalRightPublishers] = useState<string[]>([]);
  
  // Filters & Search State
  const [leftOwnerFilter, setLeftOwnerFilter] = useState<Set<string>>(new Set());
  const [rightOwnerFilter, setRightOwnerFilter] = useState<Set<string>>(new Set());
  const [leftSearchQuery, setLeftSearchQuery] = useState("");
  const [rightSearchQuery, setRightSearchQuery] = useState("");
  
  // Dropdown UI State
  const [leftFilterOpen, setLeftFilterOpen] = useState(false);
  const [rightFilterOpen, setRightFilterOpen] = useState(false);

  // Transfers State
  const [activeTransfers, setActiveTransfers] = useState<ActiveTransfer[]>([]);
  const [transferHistory, setTransferHistory] = useState<ActiveTransfer[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [isMounted, setIsMounted] = useState(false);
  const router = useRouter();

  const currentLeftFolder = leftHistory[leftHistory.length - 1]?.id || "root";
  const currentRightFolder = rightHistory[rightHistory.length - 1]?.id || "root";

  // Persistent History & Auth check
  useEffect(() => {
    setIsMounted(true);
    
    // Load state from session
    const savedLeft = sessionStorage.getItem("leftHistory");
    const savedRight = sessionStorage.getItem("rightHistory");
    const savedTransfers = localStorage.getItem("transferHistory");
    
    if (savedLeft) setLeftHistory(JSON.parse(savedLeft));
    if (savedRight) setRightHistory(JSON.parse(savedRight));
    if (savedTransfers) setTransferHistory(JSON.parse(savedTransfers));

    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    
    if (urlToken) {
      localStorage.setItem("token", urlToken);
      window.history.replaceState({}, document.title, "/");
    }

    const token = localStorage.getItem("token");
    if (!token) {
      router.push("/login");
      return;
    }

    fetch("http://localhost:8000/api/accounts", {
      headers: { "Authorization": `Bearer ${token}` }
    })
      .then((res) => {
        if (!res.ok) throw new Error("Unauthorized");
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) {
          setAccounts(data);
          const primary = data.find(a => a.name === "Personal Account" || a.name === "Primary Account") || data[0];
          const subs = data.filter(a => a.id !== primary?.id);
          if (primary) setLeftAccount(primary.id);
          if (subs.length > 0) setRightAccount(subs[0].id);
        } else {
          setAccounts([]);
        }
      })
      .catch(() => {
        localStorage.removeItem("token");
        router.push("/login");
      });
  }, [router]);

  // Save state to session
  useEffect(() => {
    if (isMounted) sessionStorage.setItem("leftHistory", JSON.stringify(leftHistory));
  }, [leftHistory, isMounted]);

  useEffect(() => {
    if (isMounted) sessionStorage.setItem("rightHistory", JSON.stringify(rightHistory));
  }, [rightHistory, isMounted]);

  useEffect(() => {
    if (isMounted) localStorage.setItem("transferHistory", JSON.stringify(transferHistory));
  }, [transferHistory, isMounted]);

  // Reset folder history and fetch global publishers if right account CHANGES (not on first load)
  useEffect(() => {
    if (rightAccount !== null && prevRightAccount !== null && rightAccount !== prevRightAccount) {
      setRightHistory([{id: "root", name: "Root Directory"}]);
    }
    if (rightAccount !== null) setPrevRightAccount(rightAccount);
  }, [rightAccount, prevRightAccount]);

  useEffect(() => { 
    if (!leftAccount) return;
    setLeftSelected(new Set());
    setLeftOwnerFilter(new Set());
    setLeftSearchQuery("");
    const token = localStorage.getItem("token");
    fetch(`http://localhost:8000/api/accounts/${leftAccount}/publishers`, {
      headers: { "Authorization": `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => setGlobalLeftPublishers(Array.isArray(data) ? data : []));
  }, [leftAccount]);
  
  useEffect(() => { 
    if (!rightAccount) return;
    setRightSelected(new Set());
    setRightOwnerFilter(new Set());
    setRightSearchQuery("");
    const token = localStorage.getItem("token");
    fetch(`http://localhost:8000/api/accounts/${rightAccount}/publishers`, {
      headers: { "Authorization": `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => setGlobalRightPublishers(Array.isArray(data) ? data : []));
  }, [rightAccount]);

  // Fetch files (depends on refreshTrigger to auto-update when transfers finish)
  useEffect(() => {
    if (leftAccount && currentLeftFolder) {
      const token = localStorage.getItem("token");
      fetch(`http://localhost:8000/api/accounts/${leftAccount}/files?folder_id=${currentLeftFolder}`, {
        headers: { "Authorization": `Bearer ${token}` }
      })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setLeftFiles(data);
        });
    }
  }, [leftAccount, currentLeftFolder, refreshTrigger]);

  useEffect(() => {
    if (rightAccount && currentRightFolder) {
      const token = localStorage.getItem("token");
      fetch(`http://localhost:8000/api/accounts/${rightAccount}/files?folder_id=${currentRightFolder}`, {
        headers: { "Authorization": `Bearer ${token}` }
      })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setRightFiles(data);
        });
    }
  }, [rightAccount, currentRightFolder, refreshTrigger]);

  // Transfer Polling
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveTransfers(prev => {
        const pending = prev.filter(t => t.status !== 'SUCCESS' && t.status !== 'FAILURE');
        if (pending.length === 0) return prev;
        
        pending.forEach(async (t) => {
          try {
            const res = await fetch(`http://localhost:8000/api/transfer/${t.taskId}`);
            if (!res.ok) return;
            const data = await res.json();
            
            setActiveTransfers(current => current.map(pt => {
              if (pt.taskId === t.taskId) {
                const newStatus = data.state || 'UNKNOWN';
                const newProgress = data.state === 'SUCCESS' ? 100 : (data.progress || pt.progress);
                
                // Trigger file refresh if we just finished
                if (newStatus === 'SUCCESS' && pt.status !== 'SUCCESS') {
                  setRefreshTrigger(r => r + 1);
                }
                
                return { ...pt, progress: newProgress, status: newStatus };
              }
              return pt;
            }));
          } catch(e) {}
        });
        return prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const toggleSelect = (id: string, isLeft: boolean) => {
    const setter = isLeft ? setLeftSelected : setRightSelected;
    setter(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDrop = async (e: React.DragEvent, destAccountId: number, destFolderId: string) => {
    e.preventDefault();
    const sourceAccountId = parseInt(e.dataTransfer.getData("sourceAccountId"));
    const fileIds = JSON.parse(e.dataTransfer.getData("fileIds") || "[]");

    if (sourceAccountId === destAccountId || fileIds.length === 0) return;

    const sourceFiles = sourceAccountId === leftAccount ? leftFiles : rightFiles;
    await initiateTransfers(fileIds, sourceAccountId, destAccountId, destFolderId, sourceFiles);
    
    // Clear selection after drop
    if (sourceAccountId === leftAccount) setLeftSelected(new Set());
    if (sourceAccountId === rightAccount) setRightSelected(new Set());
  };

  const initiateTransfers = async (fileIds: string[], sourceAccountId: number, destAccountId: number, destFolderId: string, sourceFiles: FileItem[]) => {
    const token = localStorage.getItem("token");
    const newTransfers: ActiveTransfer[] = [];
    
    for (const fileId of fileIds) {
      const fName = sourceFiles.find(f => f.id === fileId)?.name || "Unknown File";
      
      const payload: TransferPayload = {
        source_account_id: sourceAccountId,
        dest_account_id: destAccountId,
        file_id: fileId,
        dest_folder_id: destFolderId,
      };

      const res = await fetch("http://localhost:8000/api/transfer", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload),
      });
      
      if (res.ok) {
        const data = await res.json();
        newTransfers.push({
          taskId: data.task_id,
          fileName: fName,
          progress: 0,
          status: 'PENDING',
          payload: payload,
          timestamp: Date.now()
        });
      }
    }
    
    setActiveTransfers(prev => [...newTransfers, ...prev]);
  };

  const handleRetry = async (job: ActiveTransfer) => {
    // Remove from history
    setTransferHistory(prev => prev.filter(t => t.taskId !== job.taskId));
    
    const token = localStorage.getItem("token");
    const res = await fetch("http://localhost:8000/api/transfer", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(job.payload),
    });
    
    if (res.ok) {
      const data = await res.json();
      setActiveTransfers(prev => [{
        taskId: data.task_id,
        fileName: job.fileName,
        progress: 0,
        status: 'PENDING',
        payload: job.payload,
        timestamp: Date.now()
      }, ...prev]);
    }
  };

  const handleClearActiveLog = () => {
    setTransferHistory(prev => {
      // Prepend all completed active transfers into history (keep max 100)
      return [...activeTransfers, ...prev].slice(0, 100);
    });
    setActiveTransfers([]);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };

  const handleDragStart = (e: React.DragEvent, fileId: string, accountId: number, selectedSet: Set<string>) => {
    const idsToTransfer = selectedSet.has(fileId) ? Array.from(selectedSet) : [fileId];
    e.dataTransfer.setData("fileIds", JSON.stringify(idsToTransfer));
    e.dataTransfer.setData("sourceAccountId", accountId.toString());
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    router.push("/login");
  };

  const handleAddDrive = () => {
    const token = localStorage.getItem("token");
    window.location.href = `http://localhost:8000/api/auth/google/login?token=${token}`;
  };

  // Filter Derived Data
  const leftUniqueOwners = Array.from(new Set([...globalLeftPublishers, ...leftFiles.map(f => f.owner || "Unknown")])).sort();
  const rightUniqueOwners = Array.from(new Set([...globalRightPublishers, ...rightFiles.map(f => f.owner || "Unknown")])).sort();

  const visibleLeftFiles = leftFiles.filter(f => {
    const matchesOwner = leftOwnerFilter.size === 0 || leftOwnerFilter.has(f.owner || "Unknown");
    const matchesSearch = f.name.toLowerCase().includes(leftSearchQuery.toLowerCase());
    return matchesOwner && matchesSearch;
  });
  
  const visibleRightFiles = rightFiles.filter(f => {
    const matchesOwner = rightOwnerFilter.size === 0 || rightOwnerFilter.has(f.owner || "Unknown");
    const matchesSearch = f.name.toLowerCase().includes(rightSearchQuery.toLowerCase());
    return matchesOwner && matchesSearch;
  });

  const primaryAccountDetails = accounts.find(a => a.id === leftAccount);
  const secondaryAccountDetails = accounts.find(a => a.id === rightAccount);
  const subAccountsList = accounts.filter(a => a.id !== leftAccount);

  // Selection Counts
  const leftSelectedFolders = Array.from(leftSelected).filter(id => leftFiles.find(f => f.id === id)?.type === 'folder').length;
  const leftSelectedFiles = leftSelected.size - leftSelectedFolders;
  
  const rightSelectedFolders = Array.from(rightSelected).filter(id => rightFiles.find(f => f.id === id)?.type === 'folder').length;
  const rightSelectedFiles = rightSelected.size - rightSelectedFolders;

  if (!isMounted) return null;

  const renderBreadcrumbs = (history: HistoryItem[], setHistory: (h: HistoryItem[]) => void) => (
    <div className="flex text-xs font-mono uppercase tracking-widest h-8 items-center overflow-x-auto whitespace-nowrap">
      {history.map((h, i) => (
        <span key={`${h.id}-${i}`} className="flex items-center">
          <button 
            onClick={() => setHistory(history.slice(0, i + 1))}
            className="text-foreground hover:text-accent hover:underline decoration-1 underline-offset-4 font-bold"
          >
            {h.name}
          </button>
          {i < history.length - 1 && <span className="mx-2 text-muted">/</span>}
        </span>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-screen-xl mx-auto">
      
      {/* Header Section */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 border-b-4 border-foreground pb-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 mb-2">Edition: Localhost</p>
          <h1 className="text-5xl md:text-7xl font-serif font-black tracking-tighter uppercase leading-[0.9]">
            The Multi-Drive
            <br />
            Manager.
          </h1>
        </div>
        <div className="mt-6 md:mt-0 flex gap-4">
          <button 
            onClick={handleAddDrive}
            className="border border-foreground bg-transparent px-4 py-2 font-mono text-xs font-bold uppercase tracking-widest text-foreground hover:bg-foreground hover:text-background transition-colors"
          >
            + Link Edition
          </button>
          <button 
            onClick={handleLogout}
            className="border border-foreground bg-foreground px-4 py-2 font-mono text-xs font-bold uppercase tracking-widest text-background hover:bg-accent hover:border-accent transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>
      
      {/* Transmission Log UI */}
      {activeTransfers.length > 0 && (
        <div className="mb-8 border-4 border-foreground bg-background newsprint-texture p-6 shadow-[8px_8px_0px_0px_#111111]">
          <h3 className="font-serif font-black uppercase text-2xl mb-4 border-b-2 border-foreground pb-2 flex justify-between items-end">
            <span>Transmission Log</span>
            <span className="font-mono text-sm tracking-widest text-neutral-500 font-normal">
              {activeTransfers.filter(t => t.status === 'SUCCESS').length} / {activeTransfers.length} Completed
            </span>
          </h3>
          <div className="space-y-4 max-h-64 overflow-y-auto pr-4">
            {activeTransfers.map(t => (
              <div key={t.taskId} className="flex flex-col gap-1">
                <div className="flex justify-between font-mono text-xs uppercase tracking-widest text-foreground font-bold">
                  <span className="truncate max-w-[60%]">{t.fileName}</span>
                  <span className={t.status === 'SUCCESS' ? 'text-green-700' : t.status === 'FAILURE' ? 'text-accent' : ''}>
                    {t.status === 'SUCCESS' ? 'COMPLETED' : t.status === 'FAILURE' ? 'FAILED' : `${t.progress}%`}
                  </span>
                </div>
                <div className="w-full h-2 border border-foreground bg-transparent relative overflow-hidden">
                  <div 
                    className={`absolute inset-y-0 left-0 transition-all duration-300 ease-out ${t.status === 'SUCCESS' ? 'bg-foreground' : t.status === 'FAILURE' ? 'bg-accent' : 'bg-neutral-400'}`} 
                    style={{ width: `${t.status === 'SUCCESS' ? 100 : t.progress}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
          {activeTransfers.every(t => t.status === 'SUCCESS' || t.status === 'FAILURE') && (
            <button 
              onClick={handleClearActiveLog}
              className="mt-6 border-2 border-foreground bg-transparent px-6 py-2 font-mono text-xs font-bold uppercase tracking-widest text-foreground hover:bg-foreground hover:text-background transition-colors w-full"
            >
              Acknowledge & Clear Log
            </button>
          )}
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="text-center p-16 border-2 border-foreground bg-background newsprint-texture hard-shadow-hover">
          <h2 className="text-3xl font-serif font-black mb-4">No Archives Found.</h2>
          <p className="font-body text-neutral-600 mb-8 max-w-md mx-auto">
            You currently have no connected drive editions on record. Link a Google Drive account to begin exploring your archives.
          </p>
          <button 
            onClick={handleAddDrive}
            className="border border-foreground bg-foreground px-6 py-3 font-mono text-xs font-bold uppercase tracking-widest text-background hover:bg-background hover:text-foreground transition-all duration-200"
          >
            Link First Edition
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 border-4 border-foreground newsprint-texture bg-background">
          
          {/* Left Column (Locked to Primary) */}
          <div 
            className="p-6 border-b lg:border-b-0 lg:border-r border-foreground flex flex-col h-[75vh] min-h-[600px]"
            onDrop={(e) => leftAccount && handleDrop(e, leftAccount, currentLeftFolder)}
            onDragOver={handleDragOver}
          >
            <div className="mb-6">
              <label className="block font-mono text-xs uppercase tracking-widest text-neutral-500 mb-2">Primary Archive (Locked)</label>
              <div className="w-full border-b-2 border-foreground bg-transparent py-2 font-serif text-2xl font-bold truncate">
                {primaryAccountDetails ? `${primaryAccountDetails.name} — ${primaryAccountDetails.email}` : "No Primary Account"}
              </div>
            </div>
            
            <div className="mb-2 pb-2 border-b border-foreground">
              {renderBreadcrumbs(leftHistory, setLeftHistory)}
            </div>

            {/* Custom Left Dropdown Filter & Search */}
            <div className="mb-4 pb-3 border-b border-foreground/30 flex flex-col lg:flex-row gap-4 lg:items-center justify-between">
              
              <div className="relative flex items-center gap-4">
                <span className="font-mono text-xs uppercase tracking-widest text-neutral-500">Publisher:</span>
                <button 
                  onClick={() => setLeftFilterOpen(!leftFilterOpen)}
                  className="flex items-center justify-between border border-foreground bg-background px-3 py-1.5 font-sans text-sm min-w-[160px] hover:bg-neutral-100 transition-colors"
                >
                  <span className="font-bold truncate max-w-[120px]">
                    {leftOwnerFilter.size === 0 
                      ? "All Names" 
                      : leftOwnerFilter.size === 1 
                        ? Array.from(leftOwnerFilter)[0] 
                        : `${leftOwnerFilter.size} Selected`}
                  </span>
                  <span className="text-xs ml-2">▼</span>
                </button>

                {leftFilterOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setLeftFilterOpen(false)}></div>
                    <div className="absolute top-[36px] left-[85px] mt-1 w-64 border-2 border-foreground bg-background shadow-[4px_4px_0px_0px_#111111] z-50 max-h-64 overflow-y-auto">
                      <label className="flex items-center gap-3 p-3 border-b border-muted cursor-pointer hover:bg-neutral-100 transition-colors">
                        <input 
                          type="checkbox"
                          className="w-4 h-4 appearance-none border border-foreground checked:bg-foreground rounded-none cursor-pointer"
                          checked={leftOwnerFilter.size === 0}
                          onChange={() => {
                            setLeftOwnerFilter(new Set());
                            setLeftFilterOpen(false);
                          }}
                        />
                        <span className="font-sans text-sm font-bold">All Names</span>
                      </label>
                      
                      {leftUniqueOwners.map(owner => (
                        <label key={owner} className="flex items-center gap-3 p-3 border-b border-muted cursor-pointer hover:bg-neutral-100 transition-colors">
                          <input 
                            type="checkbox"
                            className="w-4 h-4 appearance-none border border-foreground checked:bg-foreground rounded-none cursor-pointer"
                            checked={leftOwnerFilter.has(owner)}
                            onChange={() => {
                              setLeftOwnerFilter(prev => {
                                const next = new Set(prev);
                                if (next.has(owner)) next.delete(owner);
                                else next.add(owner);
                                return next;
                              });
                            }}
                          />
                          <span className="font-sans text-sm truncate">{owner}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="flex-1 max-w-[250px]">
                <input 
                  type="text" 
                  placeholder="Search files..."
                  className="w-full border border-foreground bg-transparent px-3 py-1.5 font-sans text-sm placeholder:text-neutral-400 focus-visible:outline-none focus-visible:bg-neutral-100"
                  value={leftSearchQuery}
                  onChange={(e) => setLeftSearchQuery(e.target.value)}
                />
              </div>

            </div>
            
            {/* Selection Status Banner */}
            {leftSelected.size > 0 && (
              <div className="flex justify-between items-center bg-foreground text-background font-mono text-xs uppercase tracking-widest p-2 mb-2 transition-all">
                <span>Selected to Transfer:</span>
                <span>[ {leftSelectedFolders} Fol. | {leftSelectedFiles} Doc. ]</span>
              </div>
            )}

            {/* Grid Header with Select All */}
            <div className="flex border-b border-foreground pb-2 mb-2 p-2 font-mono text-xs uppercase tracking-widest text-neutral-500 items-center gap-3">
              <input 
                type="checkbox"
                title="Select All"
                className="w-4 h-4 appearance-none border border-current checked:bg-accent checked:border-accent cursor-pointer rounded-none"
                checked={visibleLeftFiles.length > 0 && leftSelected.size === visibleLeftFiles.length}
                onChange={(e) => {
                  if (e.target.checked) {
                    setLeftSelected(new Set(visibleLeftFiles.map(f => f.id)));
                  } else {
                    setLeftSelected(new Set());
                  }
                }}
              />
              <div className="flex-1">Title</div>
              <div className="w-32 text-right">Publisher</div>
            </div>

            <div className="space-y-0 overflow-y-auto flex-1 border-b border-foreground">
              {visibleLeftFiles.map((file, index) => (
                <div 
                  key={`${file.id}-${index}`}
                  draggable
                  onDragStart={(e) => leftAccount && handleDragStart(e, file.id, leftAccount, leftSelected)}
                  onDoubleClick={() => {
                    if (file.type === "folder") {
                      setLeftHistory(prev => prev[prev.length - 1]?.id === file.id ? prev : [...prev, {id: file.id, name: file.name}]);
                    }
                  }}
                  className={`flex items-center gap-3 p-2 border-b border-muted text-sm select-none cursor-move transition-colors ${
                    leftSelected.has(file.id) ? "bg-foreground text-background" : "hover:bg-neutral-100 text-foreground"
                  }`}
                >
                  <input 
                    type="checkbox"
                    className="w-4 h-4 appearance-none border border-current checked:bg-accent checked:border-accent cursor-pointer rounded-none"
                    checked={leftSelected.has(file.id)}
                    onChange={() => toggleSelect(file.id, true)}
                  />
                  <div className="flex-1 flex items-center gap-3 truncate">
                    <span className="font-serif italic text-lg opacity-80">{file.type === 'folder' ? 'Fol.' : 'Doc.'}</span>
                    <span className={`truncate ${file.type === 'folder' ? 'font-serif font-bold text-base' : 'font-sans'}`}>{file.name}</span>
                  </div>
                  <div className="w-32 text-right truncate font-mono text-xs uppercase tracking-wider opacity-70">
                    {file.owner || "Unknown"}
                  </div>
                </div>
              ))}
              {visibleLeftFiles.length === 0 && (
                <div className="text-center font-mono text-xs uppercase tracking-widest text-neutral-400 mt-12">
                  [ No Records Match Filter ]
                </div>
              )}
            </div>
          </div>

          {/* Right Column (Locked to Sub Account) */}
          <div 
            className="p-6 flex flex-col h-[75vh] min-h-[600px]"
            onDrop={(e) => rightAccount && handleDrop(e, rightAccount, currentRightFolder)}
            onDragOver={handleDragOver}
          >
            <div className="mb-6">
              <label className="block font-mono text-xs uppercase tracking-widest text-neutral-500 mb-2">Secondary Archive (Locked)</label>
              {subAccountsList.length > 1 ? (
                <select 
                  className="w-full border-b-2 border-foreground bg-transparent py-2 font-serif text-2xl font-bold focus-visible:outline-none focus-visible:bg-neutral-100 cursor-pointer"
                  value={rightAccount || ""}
                  onChange={(e) => setRightAccount(parseInt(e.target.value))}
                >
                  {subAccountsList.map(acc => (
                    <option key={acc.id} value={acc.id} className="font-sans text-sm">{acc.name} — {acc.email}</option>
                  ))}
                </select>
              ) : (
                <div className="w-full border-b-2 border-foreground bg-transparent py-2 font-serif text-2xl font-bold truncate">
                  {secondaryAccountDetails ? `${secondaryAccountDetails.name} — ${secondaryAccountDetails.email}` : "No Sub Account"}
                </div>
              )}
            </div>

            <div className="mb-2 pb-2 border-b border-foreground">
              {renderBreadcrumbs(rightHistory, setRightHistory)}
            </div>

            {/* Custom Right Dropdown Filter & Search */}
            <div className="mb-4 pb-3 border-b border-foreground/30 flex flex-col lg:flex-row gap-4 lg:items-center justify-between">
              
              <div className="relative flex items-center gap-4">
                <span className="font-mono text-xs uppercase tracking-widest text-neutral-500">Publisher:</span>
                <button 
                  onClick={() => setRightFilterOpen(!rightFilterOpen)}
                  className="flex items-center justify-between border border-foreground bg-background px-3 py-1.5 font-sans text-sm min-w-[160px] hover:bg-neutral-100 transition-colors"
                >
                  <span className="font-bold truncate max-w-[120px]">
                    {rightOwnerFilter.size === 0 
                      ? "All Names" 
                      : rightOwnerFilter.size === 1 
                        ? Array.from(rightOwnerFilter)[0] 
                        : `${rightOwnerFilter.size} Selected`}
                  </span>
                  <span className="text-xs ml-2">▼</span>
                </button>

                {rightFilterOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setRightFilterOpen(false)}></div>
                    <div className="absolute top-[36px] left-[85px] mt-1 w-64 border-2 border-foreground bg-background shadow-[4px_4px_0px_0px_#111111] z-50 max-h-64 overflow-y-auto">
                      <label className="flex items-center gap-3 p-3 border-b border-muted cursor-pointer hover:bg-neutral-100 transition-colors">
                        <input 
                          type="checkbox"
                          className="w-4 h-4 appearance-none border border-foreground checked:bg-foreground rounded-none cursor-pointer"
                          checked={rightOwnerFilter.size === 0}
                          onChange={() => {
                            setRightOwnerFilter(new Set());
                            setRightFilterOpen(false);
                          }}
                        />
                        <span className="font-sans text-sm font-bold">All Names</span>
                      </label>
                      
                      {rightUniqueOwners.map(owner => (
                        <label key={owner} className="flex items-center gap-3 p-3 border-b border-muted cursor-pointer hover:bg-neutral-100 transition-colors">
                          <input 
                            type="checkbox"
                            className="w-4 h-4 appearance-none border border-foreground checked:bg-foreground rounded-none cursor-pointer"
                            checked={rightOwnerFilter.has(owner)}
                            onChange={() => {
                              setRightOwnerFilter(prev => {
                                const next = new Set(prev);
                                if (next.has(owner)) next.delete(owner);
                                else next.add(owner);
                                return next;
                              });
                            }}
                          />
                          <span className="font-sans text-sm truncate">{owner}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="flex-1 max-w-[250px]">
                <input 
                  type="text" 
                  placeholder="Search files..."
                  className="w-full border border-foreground bg-transparent px-3 py-1.5 font-sans text-sm placeholder:text-neutral-400 focus-visible:outline-none focus-visible:bg-neutral-100"
                  value={rightSearchQuery}
                  onChange={(e) => setRightSearchQuery(e.target.value)}
                />
              </div>

            </div>
            
            {/* Selection Status Banner */}
            {rightSelected.size > 0 && (
              <div className="flex justify-between items-center bg-foreground text-background font-mono text-xs uppercase tracking-widest p-2 mb-2 transition-all">
                <span>Selected to Transfer:</span>
                <span>[ {rightSelectedFolders} Fol. | {rightSelectedFiles} Doc. ]</span>
              </div>
            )}

            {/* Grid Header with Select All */}
            <div className="flex border-b border-foreground pb-2 mb-2 p-2 font-mono text-xs uppercase tracking-widest text-neutral-500 items-center gap-3">
              <input 
                type="checkbox"
                title="Select All"
                className="w-4 h-4 appearance-none border border-current checked:bg-accent checked:border-accent cursor-pointer rounded-none"
                checked={visibleRightFiles.length > 0 && rightSelected.size === visibleRightFiles.length}
                onChange={(e) => {
                  if (e.target.checked) {
                    setRightSelected(new Set(visibleRightFiles.map(f => f.id)));
                  } else {
                    setRightSelected(new Set());
                  }
                }}
              />
              <div className="flex-1">Title</div>
              <div className="w-32 text-right">Publisher</div>
            </div>

            <div className="space-y-0 overflow-y-auto flex-1 border-b border-foreground">
              {visibleRightFiles.map((file, index) => (
                <div 
                  key={`${file.id}-${index}`}
                  draggable
                  onDragStart={(e) => rightAccount && handleDragStart(e, file.id, rightAccount, rightSelected)}
                  onDoubleClick={() => {
                    if (file.type === "folder") {
                      setRightHistory(prev => prev[prev.length - 1]?.id === file.id ? prev : [...prev, {id: file.id, name: file.name}]);
                    }
                  }}
                  className={`flex items-center gap-3 p-2 border-b border-muted text-sm select-none cursor-move transition-colors ${
                    rightSelected.has(file.id) ? "bg-foreground text-background" : "hover:bg-neutral-100 text-foreground"
                  }`}
                >
                  <input 
                    type="checkbox"
                    className="w-4 h-4 appearance-none border border-current checked:bg-accent checked:border-accent cursor-pointer rounded-none"
                    checked={rightSelected.has(file.id)}
                    onChange={() => toggleSelect(file.id, false)}
                  />
                  <div className="flex-1 flex items-center gap-3 truncate">
                    <span className="font-serif italic text-lg opacity-80">{file.type === 'folder' ? 'Fol.' : 'Doc.'}</span>
                    <span className={`truncate ${file.type === 'folder' ? 'font-serif font-bold text-base' : 'font-sans'}`}>{file.name}</span>
                  </div>
                  <div className="w-32 text-right truncate font-mono text-xs uppercase tracking-wider opacity-70">
                    {file.owner || "Unknown"}
                  </div>
                </div>
              ))}
              {visibleRightFiles.length === 0 && (
                <div className="text-center font-mono text-xs uppercase tracking-widest text-neutral-400 mt-12">
                  [ No Records Match Filter ]
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Transfer History Archive */}
      {transferHistory.length > 0 && (
        <div className="mt-8 border-4 border-foreground bg-background newsprint-texture p-6 shadow-[8px_8px_0px_0px_#111111]">
          <h3 className="font-serif font-black uppercase text-2xl mb-4 border-b-2 border-foreground pb-2 flex justify-between items-end">
            <span>Archive: Past Transfers</span>
            <button 
              onClick={() => { setTransferHistory([]); localStorage.removeItem("transferHistory"); }}
              className="font-mono text-xs hover:underline decoration-2 underline-offset-4"
            >
              Clear Archive
            </button>
          </h3>
          <div className="space-y-0 max-h-64 overflow-y-auto">
            {transferHistory.map((job, i) => (
              <div key={`${job.taskId}-${i}`} className="flex justify-between items-center border-b border-muted py-3 px-2 hover:bg-neutral-100 transition-colors">
                <div className="flex flex-col">
                  <span className="font-sans font-bold text-sm truncate max-w-md">{job.fileName}</span>
                  <span className="font-mono text-xs text-neutral-500 uppercase tracking-widest mt-1">
                    {new Date(job.timestamp).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-6">
                  <span className={`font-mono text-xs font-bold uppercase tracking-widest ${job.status === 'SUCCESS' ? 'text-green-700' : 'text-accent'}`}>
                    [{job.status}]
                  </span>
                  {job.status === 'FAILURE' && (
                    <button 
                      onClick={() => handleRetry(job)}
                      className="border-2 border-foreground px-4 py-1.5 font-mono text-xs font-bold uppercase tracking-widest text-foreground hover:bg-foreground hover:text-background transition-colors"
                    >
                      Retry File
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <footer className="mt-12 border-t-2 border-foreground pt-4 flex justify-between font-mono text-xs uppercase tracking-widest text-neutral-500">
        <span>© {new Date().getFullYear()} Multi-Drive Publisher</span>
        <span>Vol 1.0 — Printed in Localhost</span>
      </footer>
    </div>
  );
}
