# =============================================================================
# Radarr Quality Definitions - extracted live from the running instance
# Controls min/max/preferred file sizes (MB per minute of runtime)
# =============================================================================

resource "radarr_quality_definition" "unknown" {
  id             = 1
  title          = "Unknown"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "workprint" {
  id             = 2
  title          = "WORKPRINT"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "cam" {
  id             = 3
  title          = "CAM"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "telesync" {
  id             = 4
  title          = "TELESYNC"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "telecine" {
  id             = 5
  title          = "TELECINE"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "regional" {
  id             = 6
  title          = "REGIONAL"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "dvdscr" {
  id             = 7
  title          = "DVDSCR"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "sdtv" {
  id             = 8
  title          = "SDTV"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "dvd" {
  id             = 9
  title          = "DVD"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "dvd_r" {
  id             = 10
  title          = "DVD-R"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "webdl_480p" {
  id             = 11
  title          = "WEBDL-480p"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "webrip_480p" {
  id             = 12
  title          = "WEBRip-480p"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "bluray_480p" {
  id             = 13
  title          = "Bluray-480p"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "bluray_576p" {
  id             = 14
  title          = "Bluray-576p"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "hdtv_720p" {
  id             = 15
  title          = "HDTV-720p"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "webdl_720p" {
  id             = 16
  title          = "WEBDL-720p"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "webrip_720p" {
  id             = 17
  title          = "WEBRip-720p"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "bluray_720p" {
  id             = 18
  title          = "Bluray-720p"
  min_size       = 0
  max_size       = 100
  preferred_size = 95
}

resource "radarr_quality_definition" "hdtv_1080p" {
  id             = 19
  title          = "HDTV-1080p"
  min_size       = 0
  max_size       = 60
  preferred_size = 40
}

resource "radarr_quality_definition" "webdl_1080p" {
  id             = 20
  title          = "WEBDL-1080p"
  min_size       = 0
  max_size       = 60
  preferred_size = 40
}

resource "radarr_quality_definition" "webrip_1080p" {
  id             = 21
  title          = "WEBRip-1080p"
  min_size       = 0
  max_size       = 60
  preferred_size = 40
}

resource "radarr_quality_definition" "bluray_1080p" {
  id             = 22
  title          = "Bluray-1080p"
  min_size       = 0
  max_size       = 60
  preferred_size = 40
}

resource "radarr_quality_definition" "remux_1080p" {
  id             = 23
  title          = "Remux-1080p"
  min_size       = 0
  max_size       = 60
  preferred_size = 40
}

resource "radarr_quality_definition" "hdtv_2160p" {
  id             = 24
  title          = "HDTV-2160p"
  min_size       = 0
  max_size       = 180
  preferred_size = 60
}

resource "radarr_quality_definition" "webdl_2160p" {
  id             = 25
  title          = "WEBDL-2160p"
  min_size       = 0
  max_size       = 180
  preferred_size = 60
}

resource "radarr_quality_definition" "webrip_2160p" {
  id             = 26
  title          = "WEBRip-2160p"
  min_size       = 0
  max_size       = 180
  preferred_size = 60
}

resource "radarr_quality_definition" "bluray_2160p" {
  id             = 27
  title          = "Bluray-2160p"
  min_size       = 0
  max_size       = 180
  preferred_size = 60
}

resource "radarr_quality_definition" "remux_2160p" {
  id             = 28
  title          = "Remux-2160p"
  min_size       = 0
  max_size       = 180
  preferred_size = 60
}

resource "radarr_quality_definition" "br_disk" {
  id             = 29
  title          = "BR-DISK"
  min_size       = 0
  max_size       = 90
  preferred_size = 60
}

resource "radarr_quality_definition" "raw_hd" {
  id             = 30
  title          = "Raw-HD"
  min_size       = 0
  max_size       = 90
  preferred_size = 60
}
