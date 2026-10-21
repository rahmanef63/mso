/** Curated Phosphor icon catalog — fill weight. Mirrors the lucide
 *  groupings but uses Phosphor's name space. The `phosphor:` prefix is
 *  added when stored in the page `icon` field — see `parseIconValue`. */

export interface PhosphorGroup {
  id: string;
  label: string;
  items: string[];
}

export const PHOSPHOR_GROUPS: PhosphorGroup[] = [
  {
    id: "general",
    label: "General",
    items: [
      "House","Star","Heart","Bookmark","Flag","Tag","Gear","Question",
      "Info","Bell","Eye","EyeSlash","Lock","LockOpen","Key","PushPin",
      "MapPin","MapTrifold","Globe","Compass","Trophy","Crown","Diamond",
      "Sparkle","Lightning","Flame",
    ],
  },
  {
    id: "files",
    label: "Files",
    items: [
      "File","FileText","FileCode","Folder","FolderOpen","Archive","Package",
      "Stack","Tray","Trash","DownloadSimple","UploadSimple","Paperclip",
      "Image","Images",
    ],
  },
  {
    id: "communication",
    label: "Communication",
    items: [
      "Envelope","ChatCircle","ChatText","PaperPlaneTilt","At","Phone","PhoneCall",
      "VideoCamera","Microphone","SpeakerHigh","Megaphone","ShareNetwork","Link",
      "ArrowSquareOut","Hash","ArrowBendUpLeft",
    ],
  },
  {
    id: "productivity",
    label: "Productivity",
    items: [
      "CheckSquare","Square","ListChecks","ListPlus","Clipboard","ClipboardText",
      "Calendar","CalendarBlank","CalendarCheck","Clock","Timer","Alarm","Hourglass",
      "Book","BookOpen","Books","Notebook","NotePencil","Pencil","PencilLine",
      "Highlighter","Eraser",
    ],
  },
  {
    id: "data",
    label: "Data",
    items: [
      "Database","Table","GridFour","ListBullets","List","Kanban","Columns","Rows",
      "ChartBar","ChartBarHorizontal","ChartLine","ChartPie","TrendUp","TrendDown",
      "Pulse","Sigma","Calculator","Percent","Binary",
    ],
  },
  {
    id: "development",
    label: "Development",
    items: [
      "Code","BracketsCurly","BracketsSquare","BracketsRound","GitBranch","GitMerge",
      "GitPullRequest","GitCommit","GithubLogo","HardDrives","Cpu","Memory","Bug",
      "Wrench","Hammer","FlowArrow","Cloud","CloudArrowUp","CloudArrowDown",
    ],
  },
  {
    id: "business",
    label: "Business",
    items: [
      "Briefcase","Buildings","Storefront","ShoppingCart","ShoppingBag","CreditCard",
      "Wallet","CurrencyDollar","Coins","Receipt","Money","Users","User","UserPlus",
      "UserCircle","UserMinus","Handshake","Target","Crosshair",
    ],
  },
  {
    id: "media",
    label: "Media",
    items: [
      "Camera","FilmStrip","MusicNote","Headphones","Radio","Television","Monitor",
      "DeviceMobile","DeviceTablet","Laptop","SpeakerSimpleHigh","Disc","Play",
      "Pause","SkipForward","SkipBack","Rewind","FastForward",
    ],
  },
  {
    id: "nature",
    label: "Nature",
    items: [
      "Sun","Moon","Cloud","CloudRain","CloudSnow","CloudLightning","Wind",
      "Snowflake","Drop","Tree","TreeEvergreen","Plant","Flower","Mountains",
      "SunHorizon","Rainbow","Tornado",
    ],
  },
  {
    id: "tools",
    label: "Tools",
    items: [
      "Wrench","Hammer","Gear","Sliders","Funnel","MagnifyingGlass","Microscope",
      "Ruler","Scissors","PaintBrush","Palette","Eyedropper","Crop","MagicWand",
      "Magnet",
    ],
  },
  {
    id: "shapes",
    label: "Shapes",
    items: [
      "Circle","Square","Triangle","Hexagon","Diamond","Heart","Plus","Minus",
      "X","Check","Asterisk","Equals","Divide","ArrowUp","ArrowDown","ArrowLeft",
      "ArrowRight","ArrowUpRight","ArrowDownRight","CaretUp","CaretDown",
      "CaretLeft","CaretRight",
    ],
  },
];

export const ALL_PHOSPHOR: string[] = Array.from(
  new Set(PHOSPHOR_GROUPS.flatMap((g) => g.items)),
);
