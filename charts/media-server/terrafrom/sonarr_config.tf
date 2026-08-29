# =============================================================================
# Sonarr - remaining config extracted live from the running instance
# =============================================================================

resource "sonarr_root_folder" "tv" {
  path = "/storage/library/tv"
}

resource "sonarr_download_client_transmission" "transmission" {
  name                       = "Transmission"
  enable                     = true
  priority                   = 1
  remove_completed_downloads = true
  remove_failed_downloads    = true
  host                       = "media.192.168.0.36.nip.io"
  port                       = 80
  use_ssl                    = false
  url_base                   = "/transmission/"
  tv_category                = "tv-sonarr"
  recent_tv_priority         = 0
  older_tv_priority          = 0
  add_paused                 = false
}

resource "sonarr_media_management" "media_management" {
  chmod_folder                = "755"
  chown_group                 = ""
  create_empty_folders        = false
  delete_empty_folders        = false
  download_propers_repacks    = "preferAndUpgrade"
  enable_media_info           = true
  episode_title_required      = "always"
  extra_file_extensions       = "srt"
  file_date                   = "none"
  hardlinks_copy              = true
  import_extra_files          = false
  minimum_free_space          = 100
  recycle_bin_days            = 7
  recycle_bin_path            = ""
  rescan_after_refresh        = "always"
  set_permissions             = false
  skip_free_space_check       = false
  unmonitor_previous_episodes = false
}

resource "sonarr_naming" "naming" {
  anime_episode_format       = "{Series Title} - S{season:00}E{episode:00} - {Episode Title} {Quality Full}"
  colon_replacement_format   = 4
  daily_episode_format       = "{Series Title} - {Air-Date} - {Episode Title} {Quality Full}"
  multi_episode_style        = 5
  rename_episodes            = false
  replace_illegal_characters = true
  season_folder_format       = "Season {season}"
  series_folder_format       = "{Series Title}"
  specials_folder_format     = "Specials"
  standard_episode_format    = "{Series Title} - S{season:00}E{episode:00} - {Episode Title} {Quality Full}"
}

resource "sonarr_remote_path_mapping" "transmission" {
  host        = "media.192.168.0.36.nip.io"
  remote_path = "/data/"
  local_path  = "/storage/downloads/transmission/data/"
}