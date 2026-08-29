# =============================================================================
# Radarr - remaining config extracted live from the running instance
# =============================================================================

resource "radarr_root_folder" "movies" {
  path = "/storage/library/movies"
}

resource "radarr_download_client_transmission" "transmission" {
  name                       = "Transmission"
  enable                     = true
  priority                   = 1
  remove_completed_downloads = true
  remove_failed_downloads    = true
  host                       = "media.192.168.0.36.nip.io"
  port                       = 80
  use_ssl                    = false
  url_base                   = "/transmission/"
  movie_category             = "radarr"
  recent_movie_priority      = 0
  older_movie_priority       = 0
  add_paused                 = false
}

resource "radarr_media_management" "media_management" {
  auto_rename_folders                         = false
  auto_unmonitor_previously_downloaded_movies = false
  chmod_folder                                = "755"
  chown_group                                 = ""
  copy_using_hardlinks                        = true
  create_empty_movie_folders                  = false
  delete_empty_folders                        = false
  download_propers_and_repacks                = "preferAndUpgrade"
  enable_media_info                           = true
  extra_file_extensions                       = "srt"
  file_date                                   = "none"
  import_extra_files                          = false
  minimum_free_space_when_importing           = 100
  paths_default_static                        = false
  recycle_bin                                 = ""
  recycle_bin_cleanup_days                    = 7
  rescan_after_refresh                        = "always"
  set_permissions_linux                       = false
  skip_free_space_check_when_importing        = false
}

resource "radarr_naming" "naming" {
  rename_movies              = false
  replace_illegal_characters = true
  colon_replacement_format   = "smart"
  standard_movie_format      = "{Movie Title} ({Release Year}) {Quality Full}"
  movie_folder_format        = "{Movie Title} ({Release Year})"
}

resource "radarr_remote_path_mapping" "transmission" {
  host        = "media.192.168.0.36.nip.io"
  remote_path = "/data/"
  local_path  = "/storage/downloads/transmission/data/"
}
