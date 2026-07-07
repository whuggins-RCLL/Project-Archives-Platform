import { Github, ExternalLink, FileText, Palette, Database, Link as LinkIcon } from 'lucide-react';
import { ProjectArtifactLinkType } from '../types';

export default function ArtifactLinkIcon({
  type,
  className = 'w-4 h-4',
}: {
  type: ProjectArtifactLinkType | undefined;
  className?: string;
}) {
  switch (type) {
    case 'github':
      return <Github className={className} aria-hidden />;
    case 'demo':
      return <ExternalLink className={className} aria-hidden />;
    case 'docs':
      return <FileText className={className} aria-hidden />;
    case 'design':
      return <Palette className={className} aria-hidden />;
    case 'dataset':
      return <Database className={className} aria-hidden />;
    default:
      return <LinkIcon className={className} aria-hidden />;
  }
}
