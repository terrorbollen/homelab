# =============================================================================
# Sonarr Quality Definitions - extracted live from the running instance
# =============================================================================

resource "sonarr_quality_definition" "unknown" {
  id             = 1
  title          = "Unknown"
  min_size       = 1
  max_size       = 199.9
  preferred_size = 95
}

resource "sonarr_quality_definition" "sdtv" {
  id             = 2
  title          = "SDTV"
  min_size       = 2
  max_size       = 100
  preferred_size = 95
}

resource "sonarr_quality_definition" "webrip_480p" {
  id             = 3
  title          = "WEBRip-480p"
  min_size       = 2
  max_size       = 100
  preferred_size = 95
}

resource "sonarr_quality_definition" "webdl_480p" {
  id             = 4
  title          = "WEBDL-480p"
  min_size       = 2
  max_size       = 100
  preferred_size = 95
}

resource "sonarr_quality_definition" "dvd" {
  id             = 5
  title          = "DVD"
  min_size       = 2
  max_size       = 100
  preferred_size = 95
}

resource "sonarr_quality_definition" "bluray_480p" {
  id             = 6
  title          = "Bluray-480p"
  min_size       = 2
  max_size       = 100
  preferred_size = 95
}

resource "sonarr_quality_definition" "bluray_576p" {
  id             = 7
  title          = "Bluray-576p"
  min_size       = 2
  max_size       = 100
  preferred_size = 95
}

resource "sonarr_quality_definition" "hdtv_720p" {
  id             = 8
  title          = "HDTV-720p"
  min_size       = 3
  max_size       = 125
  preferred_size = 95
}

resource "sonarr_quality_definition" "hdtv_1080p" {
  id             = 9
  title          = "HDTV-1080p"
  min_size       = 4
  max_size       = 125
  preferred_size = 95
}

resource "sonarr_quality_definition" "raw_hd" {
  id             = 10
  title          = "Raw-HD"
  min_size       = 4
  max_size       = 120.4
  preferred_size = 95
}

resource "sonarr_quality_definition" "webrip_720p" {
  id             = 11
  title          = "WEBRip-720p"
  min_size       = 3
  max_size       = 130
  preferred_size = 95
}

resource "sonarr_quality_definition" "webdl_720p" {
  id             = 12
  title          = "WEBDL-720p"
  min_size       = 3
  max_size       = 130
  preferred_size = 95
}

resource "sonarr_quality_definition" "bluray_720p" {
  id             = 13
  title          = "Bluray-720p"
  min_size       = 4
  max_size       = 106
  preferred_size = 38.2
}

resource "sonarr_quality_definition" "webrip_1080p" {
  id             = 14
  title          = "WEBRip-1080p"
  min_size       = 4
  max_size       = 50
  preferred_size = 20
}

resource "sonarr_quality_definition" "webdl_1080p" {
  id             = 15
  title          = "WEBDL-1080p"
  min_size       = 4
  max_size       = 50
  preferred_size = 20
}

resource "sonarr_quality_definition" "bluray_1080p" {
  id             = 16
  title          = "Bluray-1080p"
  min_size       = 4
  max_size       = 50
  preferred_size = 20
}

resource "sonarr_quality_definition" "bluray_1080p_remux" {
  id             = 17
  title          = "Bluray-1080p Remux"
  min_size       = 34.9
  max_size       = 159.2
  preferred_size = 95
}

resource "sonarr_quality_definition" "hdtv_2160p" {
  id             = 18
  title          = "HDTV-2160p"
  min_size       = 34.9
  max_size       = 158.3
  preferred_size = 69.9
}

resource "sonarr_quality_definition" "webrip_2160p" {
  id             = 19
  title          = "WEBRip-2160p"
  min_size       = 34.9
  max_size       = 159
  preferred_size = 69.9
}

resource "sonarr_quality_definition" "webdl_2160p" {
  id             = 20
  title          = "WEBDL-2160p"
  min_size       = 34.9
  max_size       = 155
  preferred_size = 66
}

resource "sonarr_quality_definition" "bluray_2160p" {
  id             = 21
  title          = "Bluray-2160p"
  min_size       = 34.9
  max_size       = 159.2
  preferred_size = 71.7
}

resource "sonarr_quality_definition" "bluray_2160p_remux" {
  id             = 22
  title          = "Bluray-2160p Remux"
  min_size       = 34.9
  max_size       = 157.1
  preferred_size = 67.9
}
