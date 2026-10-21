/** Curated lucide-react import surface for the icon picker.
 *
 *  Why this file exists: `import * as Lucide from "lucide-react"` defeats
 *  tree-shaking in some bundlers and bloats the client bundle with all
 *  ~1500 icons even when the picker only exposes ~250. Named imports
 *  here let webpack/turbopack drop the rest precisely (lucide-react sets
 *  `sideEffects: false`, so every unused import is shaken).
 *
 *  KEEP IN SYNC with `lucide-catalog.ts`. The CI guard
 *  `scripts/check-lucide-catalog.mjs` (if added) verifies every catalog
 *  name resolves through this map. Names dropped from catalog should be
 *  dropped here too to shrink the bundle.
 *
 *  GENERATED snapshot (2026-05-16). To regenerate manually:
 *    node -e 'const fs=require("fs"); const src=fs.readFileSync(
 *      "./lucide-catalog.ts","utf8"); const blocks=src.match(
 *      /items:\\s*\\[([\\s\\S]*?)\\]/g)||[]; const all=[]; blocks.forEach(
 *      b=>(b.match(/\\"([A-Z][A-Za-z0-9]+)\\"/g)||[]).forEach(s=>all.push(
 *      s.slice(1,-1)))); const L=require("lucide-react"); console.log(
 *      [...new Set(all)].sort().filter(n=>n in L).join(","));' */

import type { LucideIcon } from "lucide-react";
import {
  Activity, AlarmClock, Archive, ArrowDown, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp,
  ArrowUpRight, Asterisk, AtSign, Award, Banknote, BarChart, BarChart2, BarChart3,
  Bell, BellRing, Binary, Book, BookOpen, Bookmark, Box, Boxes,
  Braces, Brackets, Briefcase, Bug, Building, Building2, Calculator, Calendar,
  CalendarCheck, CalendarDays, Camera, Check, CheckSquare, ChevronDown, ChevronLeft, ChevronRight,
  ChevronUp, Circle, ClipboardCheck, ClipboardList, Clock, Cloud, CloudDownload, CloudLightning,
  CloudRain, CloudSnow, CloudUpload, Club, Code, Code2, Cog, Coins,
  Columns, Compass, Contact, Cpu, CreditCard, Crop, Crown, Database,
  Diamond, Disc, Disc3, Divide, DollarSign, Download, Droplet, Droplets,
  Edit, Edit3, Equal, Eraser, ExternalLink, Eye, EyeOff, FastForward,
  File, FileArchive, FileAudio, FileCode, FileImage, FileQuestion, FileSpreadsheet, FileText,
  FileVideo, Files, Film, Filter, Flag, Flame, Flower, Flower2,
  Folder, FolderKanban, FolderOpen, FolderPlus, FolderTree, Gem, GitBranch, GitCommit,
  GitMerge, GitPullRequest, Globe, Goal, Hammer, Handshake, HardDrive,
  Hash, Headphones, Heart, HelpCircle, Hexagon, Highlighter, Home, Hourglass,
  Image, Images, Inbox, Info, Kanban, Key, Laptop, Layers,
  LayoutGrid, LayoutList, Leaf, Library, LineChart, Link, List, ListChecks,
  ListTodo, Lock, Magnet, Mail, MailOpen, Map, MapPin, Megaphone,
  MemoryStick, MessageCircle, MessageSquare, Mic, MicOff, Microscope, Minus, Monitor,
  Moon, Mountain, MountainSnow, Music, Music2, Music3, Music4, Notebook,
  NotebookPen, Octagon, Package, Paintbrush, Palette, Paperclip, Pause, PenTool,
  Pencil, Pentagon, Percent, Phone, PhoneCall, PieChart, Pin, Pipette,
  Play, Plus, Radio, Rainbow, Receipt, Reply, Rewind, Rows,
  Rss, Ruler, Save, ScanSearch, Scissors, Search, Send, Server,
  Settings, Settings2, Share, Share2, ShoppingBag, ShoppingCart, Sigma, SkipBack,
  SkipForward, Slash, Sliders, Smartphone, Snowflake, Spade, Sparkles, Speaker,
  Sprout, Square, Star, StickyNote, Store, Sun, Sunrise, Sunset,
  Table, Table2, Tablet, Tag, Target, Telescope, Terminal, Timer,
  Tornado, Trash, Trash2, TreeDeciduous, TreePine, Trees, TrendingDown, TrendingUp,
  Triangle, Trophy, Tv, Tv2, Unlock, Upload, User, UserCheck,
  UserCog, UserMinus, UserPlus, Users, Video, VideoOff, Volume2, Wallet,
  Wand, Wand2, Webhook, Wind, Workflow, Wrench, Zap,
} from "lucide-react";

/** Curated map: name → component. Lookup is O(1). Unknown names resolve
 *  to `null`, and `DynamicIcon` falls back to `FileText`. */
export const LUCIDE_ICONS: Readonly<Record<string, LucideIcon>> = {
  Activity, AlarmClock, Archive, ArrowDown, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp,
  ArrowUpRight, Asterisk, AtSign, Award, Banknote, BarChart, BarChart2, BarChart3,
  Bell, BellRing, Binary, Book, BookOpen, Bookmark, Box, Boxes,
  Braces, Brackets, Briefcase, Bug, Building, Building2, Calculator, Calendar,
  CalendarCheck, CalendarDays, Camera, Check, CheckSquare, ChevronDown, ChevronLeft, ChevronRight,
  ChevronUp, Circle, ClipboardCheck, ClipboardList, Clock, Cloud, CloudDownload, CloudLightning,
  CloudRain, CloudSnow, CloudUpload, Club, Code, Code2, Cog, Coins,
  Columns, Compass, Contact, Cpu, CreditCard, Crop, Crown, Database,
  Diamond, Disc, Disc3, Divide, DollarSign, Download, Droplet, Droplets,
  Edit, Edit3, Equal, Eraser, ExternalLink, Eye, EyeOff, FastForward,
  File, FileArchive, FileAudio, FileCode, FileImage, FileQuestion, FileSpreadsheet, FileText,
  FileVideo, Files, Film, Filter, Flag, Flame, Flower, Flower2,
  Folder, FolderKanban, FolderOpen, FolderPlus, FolderTree, Gem, GitBranch, GitCommit,
  GitMerge, GitPullRequest, Globe, Goal, Hammer, Handshake, HardDrive,
  Hash, Headphones, Heart, HelpCircle, Hexagon, Highlighter, Home, Hourglass,
  Image, Images, Inbox, Info, Kanban, Key, Laptop, Layers,
  LayoutGrid, LayoutList, Leaf, Library, LineChart, Link, List, ListChecks,
  ListTodo, Lock, Magnet, Mail, MailOpen, Map, MapPin, Megaphone,
  MemoryStick, MessageCircle, MessageSquare, Mic, MicOff, Microscope, Minus, Monitor,
  Moon, Mountain, MountainSnow, Music, Music2, Music3, Music4, Notebook,
  NotebookPen, Octagon, Package, Paintbrush, Palette, Paperclip, Pause, PenTool,
  Pencil, Pentagon, Percent, Phone, PhoneCall, PieChart, Pin, Pipette,
  Play, Plus, Radio, Rainbow, Receipt, Reply, Rewind, Rows,
  Rss, Ruler, Save, ScanSearch, Scissors, Search, Send, Server,
  Settings, Settings2, Share, Share2, ShoppingBag, ShoppingCart, Sigma, SkipBack,
  SkipForward, Slash, Sliders, Smartphone, Snowflake, Spade, Sparkles, Speaker,
  Sprout, Square, Star, StickyNote, Store, Sun, Sunrise, Sunset,
  Table, Table2, Tablet, Tag, Target, Telescope, Terminal, Timer,
  Tornado, Trash, Trash2, TreeDeciduous, TreePine, Trees, TrendingDown, TrendingUp,
  Triangle, Trophy, Tv, Tv2, Unlock, Upload, User, UserCheck,
  UserCog, UserMinus, UserPlus, Users, Video, VideoOff, Volume2, Wallet,
  Wand, Wand2, Webhook, Wind, Workflow, Wrench, Zap,
};

export type LucideIconName = keyof typeof LUCIDE_ICONS;

/** Fallback used when an unknown name is passed. Re-exported so consumers
 *  can use the same fallback in their own code paths. */
export { FileText as FallbackLucideIcon };

/** Resolve a name from the curated map. Returns `null` for unknown names
 *  so callers can choose their own fallback. */
export function resolveLucideIcon(name: string): LucideIcon | null {
  return LUCIDE_ICONS[name] ?? null;
}
