from app.agent.tools import _AIRUI_BUILTIN_TYPES, _normalize_airui_component


def test_airui_builtin_types_include_expanded_renderer_capability_set():
    assert _AIRUI_BUILTIN_TYPES == {
        "Column", "Row", "Divider", "Text",
        "Button", "Input", "Select", "Switch", "Checkbox", "Radio", "Slider", "Image", "Dropdown",
        "Form", "Textarea", "DatePicker", "TimePicker", "DateRangePicker", "NumberInput",
        "Autocomplete", "MultiSelect", "FileUpload",
        "Video", "Audio", "ImageGallery", "Carousel", "Lightbox", "PDFViewer",
        "KPI", "PlateCard", "Gauge", "Progress", "Tag", "Badge", "Avatar", "Skeleton",
        "Table", "Pagination", "DataGrid", "EmptyState", "Chart",
        "Tabs", "Breadcrumb", "Steps",
        "Modal", "Drawer", "DropdownMenu",
        "Alert", "Loading", "ErrorFallback", "Tooltip", "Toast", "Notification", "Popconfirm",
        "ContextMenu", "CommandPalette",
        "Dashboard", "Widget", "Accordion", "Timeline", "Tree",
        "AppShell", "Sidebar", "TopNav", "Toolbar", "SplitPane", "ScrollArea",
        "Markdown", "CodeBlock", "RichText", "Icon",
        "Calendar", "Kanban", "Map", "NetworkGraph", "Heatmap",
    }


def test_normalize_airui_component_preserves_expanded_renderer_types_with_flexible_names():
    expected = {
        "dropdown-menu": "DropdownMenu",
        "plate_card": "PlateCard",
        "errorfallback": "ErrorFallback",
        "video-player": "Video",
        "pdf-viewer": "PDFViewer",
        "data-grid": "DataGrid",
        "command_palette": "CommandPalette",
        "empty-state": "EmptyState",
        "rich-text": "RichText",
        "network-graph": "NetworkGraph",
    }

    for raw_type, normalized_type in expected.items():
        component = _normalize_airui_component({"type": raw_type, "props": {}})
        assert component["type"] == normalized_type

