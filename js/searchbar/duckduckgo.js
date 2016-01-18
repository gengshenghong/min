var bangRegex = /!\w+/g;
var serarea = searchbar.querySelector(".search-engine-results");
var iaarea = searchbar.querySelector(".instant-answer-results");
var topAnswerarea = searchbar.querySelector(".top-answer-results");
var suggestedsitearea = searchbar.querySelector("#searchbar .ddg-site-results");

//cache duckduckgo bangs so we make fewer network requests
var cachedBangSnippets = {};

/* custom answer layouts */

var IAFormats = {
	color_code: function (searchText, answer) {
		var alternateFormats = [answer.data.rgb, answer.data.hslc, answer.data.cmyb];

		if (searchText.indexOf("#") == -1) { //if the search is not a hex code, show the hex code as an alternate format
			alternateFormats.unshift(answer.data.hexc);
		}

		var item = $("<div class='result-item indent ddg-answer' tabindex='-1'>");
		$("<span class='title'>").text(searchText).appendTo(item);

		$("<div class='result-icon color-circle'>").css("background-color", "#" + answer.data.hex_code).prependTo(item);

		$("<span class='description-block'>").text(alternateFormats.join(" " + METADATA_SEPARATOR + " ")).appendTo(item);

		return item;
	},
	minecraft: function (searchText, answer) {

		var item = $("<div class='result-item indent ddg-answer' tabindex='-1'>");

		$("<span class='title'>").text(answer.data.title).appendTo(item);
		$("<img class='result-icon image'>").attr("src", answer.data.image).prependTo(item);
		$("<span class='description-block'>").text(answer.data.description + " " + answer.data.subtitle).appendTo(item);

		return item;
	},
	figlet: function (searchText, answer) {
		var formattedAnswer = removeTags(answer).replace("Font: standard", "");

		var item = $("<div class='result-item indent ddg-answer' tabindex='-1'>");
		var desc = $("<span class='description-block'>").text(formattedAnswer).appendTo(item);

		//display the data correctly
		desc.css({
			"white-space": "pre-wrap",
			"font-family": "monospace",
			"max-height": "10em",
			"-webkit-user-select": "auto",
		});

		return item;

	},
	currency_in: function (searchText, answer) {
		var item = $("<div class='result-item indent ddg-answer' tabindex='-1'>");
		var title = "";
		if (typeof answer == "string") { //there is only one currency
			title = answer;
		} else { //multiple currencies
			var currencyArr = []
			for (var countryCode in answer.data.record_data) {
				currencyArr.push(answer.data.record_data[countryCode] + " (" + countryCode + ")");
			}

			title = currencyArr.join(", ");
		}

		var desc = $("<span class='title title-block'>").text(title).appendTo(item);
		if (answer.data) {
			var subtitle = $("<span class='description-block'>").text(answer.data.title).appendTo(item);
		} else {
			var subtitle = $("<span class='description-block'>").text("Answer").appendTo(item);
		}

		return item;
	},
}

//this is triggered from history.js - we only show search suggestions if we don't have history results
window.showSearchSuggestions = throttle(function (text, input, itemsToShow) {

	if (!text || tabs.get(tabs.getSelected()).private) { //we don't show search suggestions in private tabs, since this would send typed text to DDG
		return;
	}

	itemsToShow = Math.max(2, itemsToShow);

	fetch("https://ac.duckduckgo.com/ac/?q=" + encodeURIComponent(text))
		.then(function (response) {
			return response.json();
		})
		.then(function (results) {

			empty(serarea);

			if (results && results[0] && results[0].snippet) { //!bang search - ddg api doesn't have a good way to detect this

				results.splice(0, 5).forEach(function (result) {
					cachedBangSnippets[result.phrase] = result.snippet;

					//autocomplete the bang, but allow the user to keep typing

					var data = {
						image: result.image,
						imageIsInline: true,
						title: result.snippet,
						secondaryText: result.phrase
					}

					var item = createSearchbarItem(data);

					item.addEventListener("click", function () {
						setTimeout(function () {
							input.value = result.phrase + " ";
							input.focus();
						}, 66);
					});

					serarea.appendChild(item);
				});

			} else if (results) {
				results.splice(0, itemsToShow).forEach(function (result) {

					var data = {
						title: result.phrase,
						classList: ["iadata-onfocus"],
					}

					if (bangRegex.test(result.phrase)) {

						data.title = result.phrase.replace(bangRegex, "");

						var bang = result.phrase.match(bangRegex)[0];
						data.secondaryText = "Search on " + cachedBangSnippets[bang];
					}

					if (urlParser.isURL(result.phrase) || urlParser.isURLMissingProtocol(result.phrase)) { //website suggestions
						data.icon = "fa-globe";
					} else { //regular search results
						data.icon = "fa-search";
					}

					var item = createSearchbarItem(data);

					item.addEventListener("click", function (e) {
						openURLFromsearchbar(e, result.phrase);
					});

					serarea.appendChild(item);
				});
			}
		});

}, 500);

window.showInstantAnswers = debounce(function (text, input, options) {

	options = options || {};

	if (!text) {
		empty(iaarea);
		empty(suggestedsitearea);
		return;
	}

	//don't make useless queries
	if (urlParser.isURLMissingProtocol(text)) {
		return;
	}

	//don't send typed text in private mode
	if (tabs.get(tabs.getSelected()).private) {
		return;
	}

	if (text.length > 3) {

		fetch("https://api.duckduckgo.com/?skip_disambig=1&no_redirect=1&format=json&q=" + encodeURIComponent(text))
			.then(function (data) {
				return data.json();
			})
			.then(function (res) {

				//if value has changed, don't show results
				if (text != getValue(input) && !options.alwaysShow) {
					return;
				}

				//if there is a custom format for the answer, use that
				if (IAFormats[res.AnswerType]) {
					var item = IAFormats[res.AnswerType](text, res.Answer).get(0);

				} else if (res.Abstract || res.Answer) {

					var data = {
						title: removeTags(res.Answer || res.Heading),
						descriptionBlock: res.Abstract || "Answer",
						classList: ["ddg-answer", "indent"]
					}

					if (res.Image && !res.ImageIsLogo) {
						data.image = res.Image;
					}

					var item = createSearchbarItem(data);
				}

				if (options.destroyPrevious != false || item) {
					$searchbar.find(".ddg-answer").remove();
				}

				if (item) {
					item.addEventListener("click", function (e) {
						openURLFromsearchbar(e, res.AbstractURL || text);
					});

					//answers are more relevant, they should be displayed at the top
					if (res.Answer) {
						empty(topAnswerarea);
						topAnswerarea.appendChild(item);
					} else {
						iaarea.appendChild(item);
					}

				}

				//suggested site links


				if (res.Results && res.Results[0] && res.Results[0].FirstURL) {

					var url = res.Results[0].FirstURL;

					var data = {
						icon: "fa-globe",
						title: urlParser.removeProtocol(url).replace(trailingSlashRegex, ""),
						secondaryText: "Suggested site",
						url: url,
						classList: ["ddg-answer"],
					}

					var item = createSearchbarItem(data);

					item.addEventListener("click", function (e) {
						openURLFromsearchbar(e, res.Results[0].FirstURL);
					});

					suggestedsitearea.appendChild(item);
				}

				//if we're showing a location, show a "Search on OpenStreetMap" link

				var entitiesWithLocations = ["location", "country", "u.s. state", "protected area"];

				if (entitiesWithLocations.indexOf(res.Entity) != -1) {

					var item = createSearchbarItem({
						icon: "fa-search",
						title: res.Heading,
						secondaryText: "Search on OpenStreetMap",
						classList: ["ddg-answer"]
					});

					item.addEventListener("click", function (e) {
						openURLFromsearchbar(e, "https://www.openstreetmap.org/search?query=" + encodeURIComponent(res.Heading));
					});

					iaarea.insertBefore(item, iaarea.firstChild);
				}


			})
			.catch(function (e) {
				console.error(e);
			});
	} else {
		$searchbar.find(".ddg-answer").remove(); //we still want to remove old items, even if we didn't make a new request
	}

}, 450);
