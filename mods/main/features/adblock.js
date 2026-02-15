export function applyAdCleanup(parsedResponse, adBlockEnabled) {
  if (parsedResponse.adPlacements && adBlockEnabled) {
    parsedResponse.adPlacements = [];
  }

  if (parsedResponse.playerAds && adBlockEnabled) {
    parsedResponse.playerAds = false;
  }

  if (parsedResponse.adSlots && adBlockEnabled) {
    parsedResponse.adSlots = [];
  }

  if (!Array.isArray(parsedResponse) && parsedResponse?.entries && adBlockEnabled) {
    parsedResponse.entries = parsedResponse.entries?.filter(
      (entry) => !entry?.command?.reelWatchEndpoint?.adClientParams?.isAd
    );
  }
}
