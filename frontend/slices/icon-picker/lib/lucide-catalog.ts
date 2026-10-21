/** Curated subset of lucide icons grouped by category. Names match the
 *  exported PascalCase symbols from `lucide-react`. The `lucide:` prefix is
 *  added when stored in the page `icon` field — see `parseIconValue`. */

export interface LucideGroup {
  id: string;
  label: string;
  items: string[];
}

export const LUCIDE_GROUPS: LucideGroup[] = [
  {
    id: "general",
    label: "General",
    items: [
      "Home","Star","Heart","Bookmark","Flag","Tag","Settings","HelpCircle",
      "Info","Bell","Eye","EyeOff","Lock","Unlock","Key","Pin","MapPin","Map",
      "Globe","Compass","Award","Crown","Gem","Sparkles","Zap","Flame","Trophy",
    ],
  },
  {
    id: "files",
    label: "Files",
    items: [
      "File","FileText","FileCode","FileImage","FileVideo","FileAudio","FileSpreadsheet",
      "FileArchive","FileQuestion","Files","Folder","FolderOpen","FolderKanban","FolderPlus",
      "FolderTree","Archive","Box","Boxes","Package","Layers","Inbox","Trash","Trash2",
      "Save","Download","Upload","Paperclip","Image","Images",
    ],
  },
  {
    id: "communication",
    label: "Communication",
    items: [
      "Mail","MailOpen","MessageCircle","MessageSquare","Send","AtSign","Phone","PhoneCall",
      "Video","VideoOff","Mic","MicOff","Volume2","BellRing","Megaphone","Share","Share2",
      "Link","ExternalLink","Rss","Hash","Reply",
    ],
  },
  {
    id: "productivity",
    label: "Productivity",
    items: [
      "CheckSquare","Square","ListChecks","ListTodo","ClipboardList","ClipboardCheck",
      "Calendar","CalendarDays","CalendarCheck","Clock","Timer","AlarmClock","Hourglass",
      "Bookmark","BookOpen","Book","Library","Notebook","NotebookPen","StickyNote",
      "PenTool","Pencil","Edit","Edit3","Highlighter","Eraser",
    ],
  },
  {
    id: "data",
    label: "Data",
    items: [
      "Database","Table","Table2","LayoutGrid","LayoutList","List","Kanban","Columns",
      "Rows","BarChart","BarChart2","BarChart3","LineChart","PieChart","TrendingUp",
      "TrendingDown","Activity","Sigma","Calculator","Hash","Percent","Binary",
    ],
  },
  {
    id: "development",
    label: "Development",
    items: [
      "Code","Code2","Terminal","Braces","Brackets","GitBranch","GitMerge","GitPullRequest",
      "GitCommit","Server","Cpu","HardDrive","MemoryStick","Bug","Wrench","Hammer",
      "Cog","Workflow","Webhook","Cloud","CloudUpload","CloudDownload",
    ],
  },
  {
    id: "business",
    label: "Business",
    items: [
      "Briefcase","Building","Building2","Store","ShoppingCart","ShoppingBag","CreditCard",
      "Wallet","DollarSign","Coins","Receipt","Banknote","Calendar","Users","User","UserPlus",
      "UserCheck","UserCog","UserMinus","Contact","Handshake","Target","Goal","TrendingUp",
    ],
  },
  {
    id: "media",
    label: "Media",
    items: [
      "Image","Camera","Film","Music","Music2","Music3","Music4","Headphones","Radio",
      "Tv","Tv2","Monitor","Smartphone","Tablet","Laptop","Speaker","Disc","Disc3",
      "Play","Pause","SkipForward","SkipBack","Rewind","FastForward",
    ],
  },
  {
    id: "nature",
    label: "Nature",
    items: [
      "Sun","Moon","Cloud","CloudRain","CloudSnow","CloudLightning","Wind","Snowflake",
      "Droplet","Droplets","Leaf","Trees","TreePine","TreeDeciduous","Sprout","Flower",
      "Flower2","Mountain","MountainSnow","Sunrise","Sunset","Rainbow","Tornado",
    ],
  },
  {
    id: "tools",
    label: "Tools",
    items: [
      "Wrench","Hammer","Settings","Settings2","Cog","Sliders","Filter",
      "Search","ScanSearch","Microscope","Telescope","Ruler","Scissors","Paintbrush",
      "Palette","Pipette","Crop","Wand","Wand2","Magnet",
    ],
  },
  {
    id: "shapes",
    label: "Shapes",
    items: [
      "Circle","Square","Triangle","Hexagon","Pentagon","Octagon","Diamond","Spade",
      "Club","Heart","Plus","Minus","X","Check","Asterisk","Slash","Equal","Divide",
      "ArrowUp","ArrowDown","ArrowLeft","ArrowRight","ArrowUpRight","ArrowDownRight",
      "ChevronUp","ChevronDown","ChevronLeft","ChevronRight",
    ],
  },
];

export const ALL_LUCIDE: string[] = Array.from(
  new Set(LUCIDE_GROUPS.flatMap((g) => g.items)),
);
