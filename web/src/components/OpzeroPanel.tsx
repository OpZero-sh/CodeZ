import { useEffect, useState } from "react";
import { Folder, Github, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { store } from "@/lib/store";

function encodeProjectSlug(absPath: string): string {
  return absPath.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

interface OpzeroProject {
  name: string;
  path: string;
  hasGit: boolean;
}

interface OpzeroPanelProps {
  onClose: () => void;
}

export default function OpzeroPanel({ onClose }: OpzeroPanelProps) {
  const [loading, setLoading] = useState(true);
  const [localProjects, setLocalProjects] = useState<OpzeroProject[]>([]);
  const [githubProjects, setGithubProjects] = useState<OpzeroProject[]>([]);

  useEffect(() => {
    api.listOpzeroProjects()
      .then((data) => {
        setLocalProjects(data.localProjects);
        setGithubProjects(data.githubProjects);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function openProject(cwd: string) {
    const slug = encodeProjectSlug(cwd) || "project";
    store.createSession(slug, cwd).catch(() => {});
    onClose();
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Github className="h-4 w-4" />
          <span className="text-sm font-medium">Integrations</span>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
        ) : (
          <>
            <div className="p-3 border-b">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                <Folder className="h-3.5 w-3.5" />
                Local Projects
              </div>
              {localProjects.length === 0 ? (
                <div className="text-xs text-muted-foreground">No projects found in ~/opz/</div>
              ) : (
                <div className="space-y-1">
                  {localProjects.map((project) => (
                    <button
                      key={project.path}
                      type="button"
                      onClick={() => openProject(project.path)}
                      className="w-full flex items-center justify-between p-2 rounded hover:bg-secondary/50 text-left transition-colors"
                    >
                      <span className="text-sm truncate">{project.name}</span>
                      <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                <Github className="h-3.5 w-3.5" />
                GitHub Org
              </div>
              {githubProjects.length === 0 ? (
                <div className="text-xs text-muted-foreground">No projects found in ~/opz/opzero-sh/</div>
              ) : (
                <div className="space-y-1">
                  {githubProjects.map((project) => (
                    <button
                      key={project.path}
                      type="button"
                      onClick={() => openProject(project.path)}
                      className="w-full flex items-center justify-between p-2 rounded hover:bg-secondary/50 text-left transition-colors"
                    >
                      <span className="text-sm truncate">{project.name}</span>
                      <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}