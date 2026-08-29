# =============================================================================
# Prowlarr Indexers - extracted live from the running instance
# =============================================================================

resource "prowlarr_indexer" "isohunt2" {
  name            = "Isohunt2"
  enable          = true
  implementation  = "Cardigann"
  config_contract = "CardigannSettings"
  protocol        = "torrent"
  priority        = 25
  app_profile_id  = 1
  redirect        = false
  tags            = []
  fields = [
    { name = "torrentBaseSettings.preferMagnetUrl", bool_value = false },
    { name = "baseSettings.limitsUnit", number_value = 0 },
    { name = "category", number_value = 0 },
    { name = "definitionFile", text_value = "isohunt2" },
    { name = "sort", number_value = 0 },
    { name = "torrentBaseSettings.appMinimumSeeders", number_value = 10 },
    { name = "torrentBaseSettings.seedRatio", number_value = 100 }
  ]
}

resource "prowlarr_indexer" "kickasstorrentsws" {
  name            = "kickasstorrents.ws"
  enable          = true
  implementation  = "Cardigann"
  config_contract = "CardigannSettings"
  protocol        = "torrent"
  priority        = 25
  app_profile_id  = 1
  redirect        = false
  tags            = []
  fields = [
    { name = "torrentBaseSettings.preferMagnetUrl", bool_value = false },
    { name = "baseSettings.limitsUnit", number_value = 0 },
    { name = "definitionFile", text_value = "kickasstorrents-ws" },
    { name = "sort", number_value = 2 },
    { name = "torrentBaseSettings.appMinimumSeeders", number_value = 10 },
    { name = "torrentBaseSettings.seedRatio", number_value = 100 },
    { name = "type", number_value = 1 }
  ]
}

resource "prowlarr_indexer" "limetorrents" {
  name            = "LimeTorrents"
  enable          = true
  implementation  = "Cardigann"
  config_contract = "CardigannSettings"
  protocol        = "torrent"
  priority        = 3
  app_profile_id  = 1
  redirect        = false
  tags            = []
  fields = [
    { name = "torrentBaseSettings.preferMagnetUrl", bool_value = false },
    { name = "baseSettings.limitsUnit", number_value = 0 },
    { name = "definitionFile", text_value = "limetorrents" },
    { name = "fallbackdownloadlink", number_value = 0 },
    { name = "primarydownloadlink", number_value = 1 },
    { name = "sort", number_value = 0 },
    { name = "torrentBaseSettings.appMinimumSeeders", number_value = 10 },
    { name = "torrentBaseSettings.seedRatio", number_value = 100 }
  ]
}

resource "prowlarr_indexer" "magnet_cat" {
  name            = "Magnet Cat"
  enable          = true
  implementation  = "Cardigann"
  config_contract = "CardigannSettings"
  protocol        = "torrent"
  priority        = 25
  app_profile_id  = 1
  redirect        = false
  tags            = []
  fields = [
    { name = "torrentBaseSettings.preferMagnetUrl", bool_value = false },
    { name = "baseSettings.limitsUnit", number_value = 0 },
    { name = "cat-id", number_value = 0 },
    { name = "definitionFile", text_value = "magnetcat" },
    { name = "sort", number_value = 2 },
    { name = "torrentBaseSettings.appMinimumSeeders", number_value = 10 },
    { name = "torrentBaseSettings.seedRatio", number_value = 100 }
  ]
}

resource "prowlarr_indexer" "pirates_paradise" {
  name            = "Pirate's Paradise"
  enable          = true
  implementation  = "Cardigann"
  config_contract = "CardigannSettings"
  protocol        = "torrent"
  priority        = 25
  app_profile_id  = 1
  redirect        = false
  tags            = []
  fields = [
    { name = "torrentBaseSettings.preferMagnetUrl", bool_value = false },
    { name = "baseSettings.limitsUnit", number_value = 0 },
    { name = "definitionFile", text_value = "piratesparadise" },
    { name = "torrentBaseSettings.appMinimumSeeders", number_value = 10 },
    { name = "torrentBaseSettings.seedRatio", number_value = 100 }
  ]
}

data "kubernetes_secret" "prowlarr_seedpool" {
  metadata {
    name      = "prowlarr-seedpool-credentials"
    namespace = "media"
  }
}

resource "prowlarr_indexer" "seedpool_api" {
  name            = "seedpool (API)"
  enable          = true
  implementation  = "Cardigann"
  config_contract = "CardigannSettings"
  protocol        = "torrent"
  priority        = 1
  app_profile_id  = 1
  redirect        = false
  tags            = []
  fields = [
    { name = "freeleech", bool_value = false },
    { name = "torrentBaseSettings.preferMagnetUrl", bool_value = false },
    { name = "single_file_release_use_filename", bool_value = true },
    { name = "tmdbidonly", bool_value = true },
    { name = "apikey", sensitive_value = data.kubernetes_secret.prowlarr_seedpool.data["apikey"] },
    { name = "baseSettings.limitsUnit", number_value = 0 },
    { name = "baseUrl", text_value = "https://seedpool.org/" },
    { name = "definitionFile", text_value = "seedpool-api" },
    { name = "sort", number_value = 0 },
    { name = "torrentBaseSettings.seedRatio", number_value = 1 },
    { name = "type", number_value = 1 }
  ]
}

resource "prowlarr_indexer" "the_pirate_bay" {
  name            = "The Pirate Bay"
  enable          = true
  implementation  = "Cardigann"
  config_contract = "CardigannSettings"
  protocol        = "torrent"
  priority        = 25
  app_profile_id  = 1
  redirect        = false
  tags            = []
  fields = [
    { name = "torrentBaseSettings.preferMagnetUrl", bool_value = false },
    { name = "apiurl", text_value = "apibay.org" },
    { name = "baseSettings.limitsUnit", number_value = 0 },
    { name = "definitionFile", text_value = "thepiratebay" },
    { name = "top100", number_value = 6 },
    { name = "torrentBaseSettings.appMinimumSeeders", number_value = 10 },
    { name = "torrentBaseSettings.seedRatio", number_value = 100 },
    { name = "uploader", text_value = "" }
  ]
}

resource "prowlarr_indexer" "therarbg" {
  name            = "TheRARBG"
  enable          = true
  implementation  = "Cardigann"
  config_contract = "CardigannSettings"
  protocol        = "torrent"
  priority        = 1
  app_profile_id  = 1
  redirect        = false
  tags            = []
  fields = [
    { name = "torrentBaseSettings.preferMagnetUrl", bool_value = false },
    { name = "baseSettings.limitsUnit", number_value = 0 },
    { name = "definitionFile", text_value = "therarbg" },
    { name = "sort", number_value = 0 },
    { name = "torrentBaseSettings.appMinimumSeeders", number_value = 10 },
    { name = "torrentBaseSettings.seedRatio", number_value = 100 }
  ]
}
