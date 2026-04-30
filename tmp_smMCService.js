/* Last update 22/03/2024 04:40PM */
var matchScheduleResponse = [];
var grpStandingsResponse = [];
var tourstatsResponse = [];
var teamListResponse = [];
var teamSquadsResponse = [];
var innScoreResponse = [];
var momentumResponse = [];
var superovermatchsummaryResponse = [];
var SPResponse = [];
var fixtureSquadResponse = [];
var CompetitionSquadResponse = [];
var expertHTHResponse =[];
var GetTopscorerResponse = [];
var GetMostWicketersResponse = [];
angular.module('MyApp').filter('unsafe', function($sce) { return $sce.trustAsHtml; });
angular.module('MyApp').factory('mcService', ['$http','$q', function($http,$q){

	var GetMatchSchedule=function(cId,callback){
		if(t20lite)
		{
			var filename = '-matchschedule.js';
		}
		else
		{
			var filename = '-matchSchedule.js';
		}
		jQuery.jsonp(  {
			url:feedSource+'/'+cId+filename,
  			callbackParameter: "MatchSchedule",
  			success  : function (json, textStatus, xOptions) {
			  
			},
  			error : function (xOptions, textStatus) {
			 	callback(matchScheduleResponse);
			 	matchScheduleResponse = [];
			} 

			}	
  		)
	}

	var getMatches = function(cObj,callback) {
      var url = "";
      if(cObj.feedsource == undefined) cObj.feedsource = feedSource;
      if(cObj.CodingType == "T20Pro")
        var url = cObj.feedsource + "/"+cObj.CompetitionID + "-matchSchedule.js";
       else if(cObj.CodingType == "T20Lite")
        var url = cObj.feedsource + "/"+cObj.CompetitionID + "-matchschedule.js";
    	else{
    		if(t20lite)
			{
				var filename = '-matchschedule.js';
			}
			else
			{
				var filename = '-matchSchedule.js';
			}
			var url = feedSource + "/"+cObj.CompetitionID + filename;
    	}
    	
      if(url != "")
      {
         jQuery.jsonp(  {
			url:url,
  			callbackParameter: "MatchSchedule",
  			success  : function (json, textStatus, xOptions) {
			  
			},
  			error : function (xOptions, textStatus) {
			 	callback(matchScheduleResponse);
			 	matchScheduleResponse = [];
			} 

			}	
  		)
      }
      
    }

	var GetStandings=function(paramcId,callback){
		var statsBasePath = feedSource;
		if(statsFeed != undefined && statsFeed != '')
			statsBasePath = statsFeed;
		var statsT20lite = t20lite;
		if(statsCoding != undefined && statsCoding == 'T20Lite'){
			statsT20lite = true
		}
		var statsComp = paramcId;
		if(statsCID != undefined && statsCID != ''){
			statsComp = statsCID;
		}
		if(statsT20lite)
			var url = statsBasePath+'/stats/'+statsComp+"-groupstandings.js";
		else
			var url = statsBasePath+'/stats/'+statsComp+"/"+"groupstandings.js";
		console.log(url);
		jQuery.jsonp(  {
			url: url,
  			callbackParameter: "ongroupstandings",
  			success  : function (json, textStatus, xOptions) {
			  
			},
  			error : function (xOptions, textStatus) {
			 	callback(grpStandingsResponse);
			 	grpStandingsResponse = [];
			} 

			}	
  		)
	}
	var GetTournamentList=function(callback){
		var url = competitionFeedPath;
		if(competitionFeedPath == "")
			 url = feedSource + '/competition.js';
		$.ajax({
            crossDomain: true,
            type: "GET",
            contentType: "application/json; charset=utf-8",
            async: true,
            url: url,
            //url:'https://ipl-stats-sports-mechanic.s3.ap-south-1.amazonaws.com/ipl/mc/competition.js',
            dataType: "jsonp",
            jsonpCallback: 'oncomptetion',
            success: function (data) {
                callback(data);
            }
        });
	}

	var GetTeamList = function(cId,callback) {
		var statsBasePath = feedSource;
		if(statsFeed != undefined && statsFeed != '')
			statsBasePath = statsFeed;
		var statsT20lite = t20lite;
		if(statsCoding != undefined && statsCoding == 'T20Lite'){
			statsT20lite = true
		}
		var statsComp = cId;
		if(statsCID != undefined && statsCID != ''){
			statsComp = statsCID;
		}
		if(statsT20lite)
			var url = statsBasePath+'/stats/'+statsComp+"-teamlist.js";
		else
			var url = statsBasePath+'/stats/'+statsComp+"/"+"teamlist.js";
        

		jQuery.jsonp(  {
			url: url,
  			callbackParameter: "onteamlist",
  			success  : function (json, textStatus, xOptions) {
			  
			},
  			error : function (xOptions, textStatus) {
			 	callback(teamListResponse);
			 	teamListResponse = [];
			} 

			}	
  		)	
    }

    var GetTeamSquads = function(cId,callback) {
		
		var url = careerstatspath + "squadsFeeds/"+cId+"-squad.js";
        

		jQuery.jsonp(  {
			url: url,
  			callbackParameter: "onsquad",
  			success  : function (json, textStatus, xOptions) {
			  
			},
  			error : function (xOptions, textStatus) {
			 	callback(teamSquadsResponse);
			 	teamSquadsResponse = [];
			} 

			}	
  		)	
    }
     var GetPlayerProfileBattingStats = function(callback) {
		
		var url = careerstatspath + "careerstats/BattingStats.js";
        

		$.ajax({
            crossDomain: true,
            type: "GET",
            contentType: "application/json; charset=utf-8",
            async: true,
            url: url,
            //url:'feed/competition.js',
            dataType: "jsonp",
            jsonpCallback: 'playercareerbattingstats',
            success: function (data) {
                callback(data);
            }
        });
    }
    var GetPlayerProfileBowlingStats = function(callback) {
		
		var url = careerstatspath + "careerstats/BowlingStats.js";
        

		$.ajax({
            crossDomain: true,
            type: "GET",
            contentType: "application/json; charset=utf-8",
            async: true,
            url: url,
            //url:'feed/competition.js',
             dataType: "jsonp",
            jsonpCallback: 'playercareerbowlingstats',
            success: function (data) {
                callback(data);
            }
        });
    }

    var GetPlayerStats = function(cId,teamId,callback) {
	    	var statsBasePath = feedSource;
			if(statsFeed != undefined && statsFeed != '')
				statsBasePath = statsFeed;
			var statsT20lite = t20lite;
			if(statsCoding != undefined && statsCoding == 'T20Lite'){
				statsT20lite = true
			}
			var statsComp = cId;
			if(statsCID != undefined && statsCID != ''){
				statsComp = statsCID;
			}
    		if(statsT20lite)
				var url = statsBasePath+'/stats/'+statsComp+"-"+teamId+"-playerstats.js";
			else
				var url = statsBasePath+'/stats/'+statsComp+"/"+teamId+"-playerstats.js";
             $.ajax({
				crossDomain: true,
				type: "GET",
				contentType: "application/json; charset=utf-8",
				async: true,
				url: url,
				dataType: "jsonp",
				jsonpCallback: 'onplayerstats',
				success: function (data) {
					callback(data);
					
				},
				 error: function (xhr, status) {
					var response = [];
					response['result'] = 'error';
					callback(response);
				}
			}); 
    }

    var GetMatchSummary = function (matchId,callback) {
	   $.ajax({
				crossDomain: true,
				type: "GET",
				contentType: "application/json; charset=utf-8",
				async: true,
				url : feedSource+"/"+matchId+"-matchsummary.js",
				dataType: "jsonp",
                jsonpCallback:'onScoringMatchsummary',
				success: function (data) {
					callback(data);
				},
				 error: function (xhr, status) {
					var response = [];
					response['result'] = 'error';
					callback(response);
				}
			}); 
    }
	
	 var GetSuperOverMatchSummary = function (matchId,callback) {
	 	var url = feedSource+"/"+matchId+"-superovermatchsummary.js";
	  //  $.ajax({
			// 	crossDomain: true,
			// 	type: "GET",
			// 	contentType: "application/json; charset=utf-8",
			// 	async: true,
			// 	url : feedSource+"/"+matchId+"-superovermatchsummary.js",
			// 	dataType: "jsonp",
   //              jsonpCallback:'onsuperovermatchsummary',
			// 	success: function (data) {
			// 		callback(data);
			// 	},
			// 	 error: function (xhr, status) {
			// 		var response = [];
			// 		response['result'] = 'error';
			// 		callback(response);
			// 	}
			// }); 

	   	jQuery.jsonp(  {
			url: url,
  			callbackParameter: "onsuperovermatchsummary",
  			success  : function (json, textStatus, xOptions) {
			  
			},
  			error : function (xOptions, textStatus) {
			 	callback(superovermatchsummaryResponse);
			 	superovermatchsummaryResponse = [];
			} 

			}	
  		)	
    }

    var GetScoringJs = function (matchId,inn,callback) {
	  //  $.ajax({
			// 	crossDomain: true,
			// 	type: "GET",
			// 	contentType: "application/json; charset=utf-8",
			// 	async: true,
   //             	url : feedSource+"/"+matchId+'-'+inn+ '.js',
			// 	dataType: "jsonp",
   //              jsonpCallback:'onScoring',
			// 	success: function (data) {
			// 		callback(data);
			// 	},
			// 	 error: function (xhr, status) {
			// 		var response = [];
			// 		response['result'] = 'error';
			// 		callback(response);
			// 	}
			// }); 

		jQuery.jsonp(  {
				url:feedSource+"/"+matchId+'-'+inn+ '.js',
	  			callbackParameter: "onScoring",
	  			success  : function (json, textStatus, xOptions) {
				  
				},
	  			error : function (xOptions, textStatus) {
				 	callback(innScoreResponse);
				 	innScoreResponse = [];
				} 

				}	
	  		)

    }

    var GetTourKeyPerformer = function(cId,callback){
    		var statsBasePath = feedSource;
			if(statsFeed != undefined && statsFeed != '')
				statsBasePath = statsFeed;
			var statsT20lite = t20lite;
			if(statsCoding != undefined && statsCoding == 'T20Lite'){
				statsT20lite = true
			}
			var statsComp = cId;
			if(statsCID != undefined && statsCID != ''){
				statsComp = statsCID;
			}
    		if(statsT20lite)
          		var url = statsBasePath+'/stats/'+statsComp+"-tournamentkeyperformer.js";
          	else
          		var url = statsBasePath+'/stats/'+statsComp+"/tournamentkeyperformer.js";
             $.ajax({
				crossDomain: true,
				type: "GET",
				contentType: "application/json; charset=utf-8",
				async: true,
				url: url,
				dataType: "jsonp",
				jsonpCallback: 'onKeyPerformer',
				success: function (data) {
					callback(data);
				},
				 error: function (xhr, status) {
					var response = [];
					response['result'] = 'error';
					callback(response);
				}
			}); 
    }
    var GetTourStats = function(cId,callback){
    		var statsBasePath = feedSource;
			if(statsFeed != undefined && statsFeed != '')
				statsBasePath = statsFeed;
			var statsT20lite = t20lite;
			var statsComp = cId;
			if(statsCoding != undefined && statsCoding == 'T20Lite'){
				statsT20lite = true;
			}
			if(statsCID != undefined && statsCID != ''){
				statsComp = statsCID;
			}
			
    		if(statsT20lite)
          		var url = statsBasePath+'/stats/'+statsComp+"-tournamentmasterkpi.js";
          	else
          		var url = statsBasePath+'/stats/'+statsComp+"/tournamentmasterkpi.js";

		    jQuery.jsonp(  {
				url:url,
	  			callbackParameter: "onTournamentstats",
	  			success  : function (json, textStatus, xOptions) {
				  
				},
	  			error : function (xOptions, textStatus) {
				 	callback(tourstatsResponse);
				 	tourstatsResponse = [];
				} 

				}	
	  		)
          
    }
    var GetTourBattingStats=function(cId,jsonFname,callback){
    	var statsBasePath = feedSource;
		if(statsFeed != undefined && statsFeed != '')
			statsBasePath = statsFeed;
		var statsT20lite = t20lite;
		if(statsCoding != undefined && statsCoding == 'T20Lite'){
			statsT20lite = true
		}
		var statsComp = cId;
		if(statsCID != undefined && statsCID != ''){
			statsComp = statsCID;
		}
    	if(statsT20lite)
			var url = statsBasePath+'/stats/'+statsComp+"-"+jsonFname+".js";
		else
			var url = statsBasePath+'/stats/'+statsComp+"/"+jsonFname+".js";

     	$.ajax({
			crossDomain: true,
			type: "GET",
			contentType: "application/json; charset=utf-8",
			async: true,
			url: url,
			dataType: "jsonp",
			jsonpCallback: 'on'+jsonFname,
			success: function (data) {
				callback(data);
			},
			 error: function (xhr, status) {
				var response = [];
				response['result'] = 'error';
				callback(response);
			}
		});
    }
	
	
	var GetTourBattingStatsV2=function(cId,jsonFname,flName,callback){
    	var statsBasePath = feedSource;
		if(statsFeed != undefined && statsFeed != '')
			statsBasePath = statsFeed;
		var statsT20lite = t20lite;
		if(statsCoding != undefined && statsCoding == 'T20Lite'){
			statsT20lite = true
		}
		var statsComp = cId;
		if(statsCID != undefined && statsCID != ''){
			statsComp = statsCID;
		}
    	if(statsT20lite)
			var url = statsBasePath+'/stats/'+statsComp+"-"+jsonFname+".js";
		else
			var url = statsBasePath+'/stats/'+statsComp+"/"+jsonFname+".js";

		var url = "https://domesticdata.bcci.tv/live/"+cId+"/stats/player/full/"+flName+".js";
     	$.ajax({
			crossDomain: true,
			type: "GET",
			contentType: "application/json; charset=utf-8",
			async: true,
			url: url,
			dataType: "jsonp",
			jsonpCallback: 'on'+jsonFname,
			success: function (data) {
				callback(data);
			},
			 error: function (xhr, status) {
				var response = [];
				response['result'] = 'error';
				callback(response);
			}
		});
    }

    var GetTourBowlingStats=function(cId,jsonFname,callback){
    	var statsBasePath = feedSource;
		if(statsFeed != undefined && statsFeed != '')
			statsBasePath = statsFeed;
		var statsT20lite = t20lite;
		if(statsCoding != undefined && statsCoding == 'T20Lite'){
			statsT20lite = true
		}
		var statsComp = cId;
		if(statsCID != undefined && statsCID != ''){
			statsComp = statsCID;
		}
    	if(statsT20lite)
			var url = statsBasePath+'/stats/'+statsComp+"-"+jsonFname+".js";
		else
			var url = statsBasePath+'/stats/'+statsComp+"/"+jsonFname+".js";
     	$.ajax({
			crossDomain: true,
			type: "GET",
			contentType: "application/json; charset=utf-8",
			async: true,
			url: url,
			dataType: "jsonp",
			jsonpCallback: 'on'+jsonFname,
			success: function (data) {
				callback(data);
			},
			 error: function (xhr, status) {
				var response = [];
				response['result'] = 'error';
				callback(response);
			}
		});
    }
    var GetPlayerInningsWiseStats = function(cId,teamId,callback) {
	    	var statsBasePath = feedSource;
			if(statsFeed != undefined && statsFeed != '')
				statsBasePath = statsFeed;
			var statsT20lite = t20lite;
			if(statsCoding != undefined && statsCoding == 'T20Lite'){
				statsT20lite = true
			}
			var statsComp = cId;
			if(statsCID != undefined && statsCID != ''){
				statsComp = statsCID;
			}
    		if(statsT20lite)
            	var url = statsBasePath+'/stats/'+statsComp+"-"+teamId+"-playerinninswisestats.js";
            else
            	var url = statsBasePath+'/stats/'+statsComp+"/"+teamId+"-playerinninswisestats.js";
             $.ajax({
				crossDomain: true,
				type: "GET",
				contentType: "application/json; charset=utf-8",
				async: true,
				url: url,
				dataType: "jsonp",
				jsonpCallback: 'onplayerinninswisestats',
				success: function (data) {
					callback(data);
					
				},
				 error: function (xhr, status) {
					var response = [];
					response['result'] = 'error';
					callback(response);
				}
			}); 
    }

    var GetMomentum = function(inn,matchId,callback) {
    		var anlyticsBasePath = feedSource;
			if(AnalyticsFeed != undefined && AnalyticsFeed != '')
				anlyticsBasePath = AnalyticsFeed;
         	 var url = anlyticsBasePath+'/'+matchId+'/'+inn+'_momentum.js';
         	//var url = feedSource+'/'+inn+'_momentum.js';
   //          $.ajax({
			// 	crossDomain: true,
			// 	type: "GET",
			// 	contentType: "application/json; charset=utf-8",
			// 	async: true,
			// 	url: url,
			// 	dataType: "jsonp",
			// 	jsonpCallback: 'onMomentum',
			// 	success: function (data) {
			// 		callback(data);
			// 	},
			// 	error: function (xhr, status) {
			// 		var response = [];
			// 		response['result'] = 'error';
			// 		callback(response);
			// 	}
			// }); 	


            jQuery.jsonp(  {
				url:url,
	  			callbackParameter: "onMomentum",
	  			success  : function (json, textStatus, xOptions) {
				  
				},
	  			error : function (xOptions, textStatus) {
				 	callback(momentumResponse);
				 	momentumResponse = [];
				} 

				}	
	  		)

    }

    var GetScorePotential = function(matchId,inn,callback) {
    		var anlyticsBasePath = feedSource;
			if(AnalyticsFeed != undefined && AnalyticsFeed != '')
				anlyticsBasePath = AnalyticsFeed;
          var url = anlyticsBasePath+'/'+matchId+'/1_scorePotentials.js';
         //	var url = feedSource+'/1_scorePotentials.js';
   //           $.ajax({
			// 	crossDomain: true,
			// 	type: "GET",
			// 	contentType: "application/json; charset=utf-8",
			// 	async: true,
			// 	url: url,
			// 	dataType: "jsonp",
			// 	jsonpCallback: 'onScorePotentials',
			// 	success: function (data) {
			// 		callback(data);
					
			// 	},
			// 	 error: function (xhr, status) {
			// 		var response = [];
			// 		response['result'] = 'error';
			// 		callback(response);
			// 	}
			// }); 

             jQuery.jsonp(  {
				url:url,
	  			callbackParameter: "onScorePotentials",
	  			success  : function (json, textStatus, xOptions) {
				  
				},
	  			error : function (xOptions, textStatus) {
				 	callback(SPResponse);
				 	SPResponse = [];
				} 

				}	
	  		)

    }

    var GetWLProbability = function(inn,matchId,callback) {
    	var anlyticsBasePath = feedSource;
			if(AnalyticsFeed != undefined && AnalyticsFeed != '')
				anlyticsBasePath = AnalyticsFeed;
         var url = anlyticsBasePath+'/'+matchId+'/2_scorePotentials.js';
         //var url = feedSource+'/2_scorePotentials.js';
   //           $.ajax({
			// 	crossDomain: true,
			// 	type: "GET",
			// 	contentType: "application/json; charset=utf-8",
			// 	async: true,
			// 	url: url,
			// 	dataType: "jsonp",
			// 	jsonpCallback: 'onScorePotentials',
			// 	success: function (data) {
			// 		callback(data);
					
			// 	},
			// 	 error: function (xhr, status) {
			// 		var response = [];
			// 		response['result'] = 'error';
			// 		callback(response);
			// 	}
			// }); 	

			jQuery.jsonp(  {
				url:url,
	  			callbackParameter: "onScorePotentials",
	  			success  : function (json, textStatus, xOptions) {
				  
				},
	  			error : function (xOptions, textStatus) {
				 	callback(SPResponse);
				 	SPResponse = [];
				} 

				}	
	  		)
    }

    var GetWC = function(matchId,callback) {
    	var anlyticsBasePath = feedSource;
			if(AnalyticsFeed != undefined && AnalyticsFeed != '')
				anlyticsBasePath = AnalyticsFeed;
     	var url = anlyticsBasePath+'/'+matchId+'/wordcloud.js';	
     //	var url = feedSource+'/wordcloud.js';
	 	$.ajax({
			crossDomain: true,
			type: "GET",
			contentType: "application/json; charset=utf-8",
			async: true,
			url: url,
			dataType: "jsonp",
			jsonpCallback: 'onwordcloud',
			success: function (data) {
				callback(data);
			}
		}); 	
    }
     var GetSA = function(matchId,callback) {
     	var anlyticsBasePath = feedSource;
			if(AnalyticsFeed != undefined && AnalyticsFeed != '')
				anlyticsBasePath = AnalyticsFeed;
     	var url = anlyticsBasePath+'/'+matchId+'/sentimentanalysis.js';	
     //	var url = feedSource+'/sentimentanalysis.js';
	 	$.ajax({
			crossDomain: true,
			type: "GET",
			contentType: "application/json; charset=utf-8",
			async: true,
			url: url,
			dataType: "jsonp",
			jsonpCallback: 'onsentimentanalysis',
			success: function (data) {
				callback(data);
			}
		}); 	
    }
     var GetSquad = function (matchId,callback) {
        $.ajax({
            crossDomain: true,
            type: "GET",
            contentType: "application/json; charset=utf-8",
            async: true,
            url: feedSource + '/'+matchId+'-squad.js',
            dataType: "jsonp",
            jsonpCallback: 'onsquad',
            success: function (data) {
                callback(data);
            }
        });
    }
     var getoverallStats = function (cId,callback) {
     	var statsBasePath = feedSource;
		if(statsFeed != undefined && statsFeed != '')
			statsBasePath = statsFeed;
		var statsT20lite = t20lite;
		if(statsCoding != undefined && statsCoding == 'T20Lite'){
			statsT20lite = true
		}
		var statsComp = cId;
		if(statsCID != undefined && statsCID != ''){
			statsComp = statsCID;
		}
     	if(statsT20lite)
            	var url = statsBasePath+'/stats/'+statsComp+'-teamoverallstats.js';
            else
            	var url = statsBasePath+'/stats/'+statsComp+"/"+'teamoverallstats.js'
        $.ajax({
            crossDomain: true,
            type: "GET",
            contentType: "application/json; charset=utf-8",
            async: true,
            url:url,
            dataType: "jsonp",
            jsonpCallback: 'onteamoverallstats',
            success: function (data) {
                callback(data);
            }
        });
    }

    var getPhotosVideos=function(callback){
		$.ajax({
            crossDomain: true,
            type: "GET",
            contentType: "application/json; charset=utf-8",
            async: true,
            url: matchSpecificNewsPath + '/news/news.js',
            dataType: "jsonp",
            jsonpCallback: 'onNews',
            success: function (data) {
                callback(data);
            }
        });
	}

	 var getScoreCardData = function(innNo,matchId){
    	
        var defer = $q.defer();
        var i=1;
        var j=0;
        var result = [];
    	(function fetchData(){
	        $.ajax({
	            crossDomain: true,
	            type: "GET",
	            contentType: "application/json; charset=utf-8",
	            async: true,
	            url: feedSource+"/"+matchId+'-Innings'+i+ '.js',
	            //url:'feed/competition.js',
	            dataType: "jsonp",
	            jsonpCallback: 'onScoring',
	            success: function (data) {
	                if(i<innNo)
	                {
	                    result[j] = [];
	                    result[j] = data;
	                    i++;
	                    j++;
	                    defer.notify(result);
	                    fetchData();
	                }
	                else
	                {
	                    result[j] = [];
	                    result[j] = data;
	                    defer.resolve(result);
	                }
	            }
	        });


   		 })()

    	return defer.promise;
    } 

     var GetKPIInfo = function (matchID,callback) {
     	var url = feedSource+"/"+matchID+"-kpi.js";
     	// var url = "http://icct20wc2016-dev.s3.amazonaws.com/tableau/Feeds/002b8e0a39714c64-kpi.js";
	     	$.ajax({
	        crossDomain: true,
	        type: "GET",
	        contentType: "application/json; charset=utf-8", 
	        async: true,
			url: url, 
	        dataType: "jsonp",
	        jsonpCallback: "onkpi",
	        success: function (data) {
			 callback(data);
	        }
	    });
    }

    var GetFixtureSquad = function (matchId,callback) {
    	if(squadGenerationSource != undefined && squadGenerationSource != '')
    			var url = squadGenerationSource;
    		else
    			var url = feedSource;
    	jQuery.jsonp(  {
			url:url +'/squads/'+matchId+'-squad.js',
  			callbackParameter: "onsquadFixture",
  			success  : function (json, textStatus, xOptions) {
			},
  			error : function (xOptions, textStatus) {
			 	callback(fixtureSquadResponse);
			 	fixtureSquadResponse = [];
			} 

			}	
  		)
    }
	
	var GetHeadtoHead = function (matchId,callback){
    			var url = feedSource;
				jQuery.jsonp(  {
					url:url +'/stats/match/'+matchId+'-headTohead.js',
					  callbackParameter: "onMatchHTH",
					  success  : function (json, textStatus, xOptions) {
					},
					  error : function (xOptions, textStatus) {

						 callback(expertHTHResponse);
						 expertHTHResponse = [];
					} 
					
					}
					
				  )

	}

	var GettopScorer = function (compId,callback){
		var statsBasePath = feedSource;
		jQuery.jsonp(  {
			url:statsBasePath +'/stats/'+compId+'-toprunsscorers.js',
			  callbackParameter: "ontoprunsscorers",
			  success  : function (json, textStatus, xOptions) {
			},
			  error : function (xOptions, textStatus) {
				 callback(GetTopscorerResponse);
				 GetTopscorerResponse = [];
			} 
			
			}
			
		  )

}
var Gettopwicketers = function (compId,callback){

	var statsBasePath = feedSource;
	jQuery.jsonp(  {
		url:statsBasePath +'/stats/'+compId+'-mostwickets.js',
		  callbackParameter: "onmostwickets",
		  success  : function (json, textStatus, xOptions) {
		},
		  error : function (xOptions, textStatus) {
			 callback(GetMostWicketersResponse);
			 GetMostWicketersResponse = [];
		} 
		
		}
		
	  )

}
	
	var GetMediaList = function(matId,InnNo,callback) {
		if(InnNo == '')
			var url = "https://apiipl.iplt20.com/api/v1/pages/getcontentbymatchid?smMatchId="+matId+"&type=video";
		else
			var url = "https://apiipl.iplt20.com/api/v1/pages/getcontentbymatchid?smMatchId="+matId+"&type=video&inning=innings-"+InnNo;
        /* const xhr = new XMLHttpRequest();
            xhr.open("GET", url, true);
            xhr.onload = function () {
                if (this.status === 200) {
                    obj = JSON.parse(this.responseText);
                   callback(data);
                }
                else {
                }
            }
            xhr.send();
			
		//	xhr.setRequestHeader( 'X-Requested-With', 'XMLHttpRequest');
		//	xhr.setRequestHeader( 'Access-Control-Allow-Origin', '*');
			
			*/

		$.ajax({
          //  crossDomain: true,
            type: "GET",
          //  contentType: "application/json; charset=utf-8",
          //  async: true,
            url: url,
            dataType: "json",
            success: function (data) {
                callback(data);
            },
			error : function (xOptions, textStatus) {
				var data = [];
			 	callback(data);
			} 
        });
		
		
    }

    var getPhotosList = function(matId,callback) {
		var url = "https://apiipl.iplt20.com/api/v1/pages/getcontentbymatchid?smMatchId="+matId+"&type=photo";
       
		$.ajax({
            type: "GET",
            url: url,
            dataType: "json",
            success: function (data) {
                callback(data);
            }
        });	
		
    }
	
	var GetCompetitionSquads = function(cId,callback) {
		
		var url = feedSource;
    	jQuery.jsonp(  {
			url:url +'/squads/'+cId+'-competitionsquad.js',
  			callbackParameter: "onCompetitionSquad",
  			success  : function (json, textStatus, xOptions) {
			},
  			error : function (xOptions, textStatus) {
			 	callback(CompetitionSquadResponse);
			 	CompetitionSquadResponse = [];
			} 

			}	
  		)
    }
	
	var getMatchNotes = function (matchId,callback) {
        $.ajax({
            crossDomain: true,
            type: "GET",
            contentType: "application/json; charset=utf-8",
            async: true,
            url: feedSource + '/'+matchId+'-matchnotes.js',
            dataType: "jsonp",
            jsonpCallback: 'onmatchnotes',
            success: function (data) {
                callback(data);
            }
        });
    }
	
	var GetAllTimeLeaders = function (callback) {
        $.ajax({
            crossDomain: true,
            type: "GET",
            contentType: "application/json; charset=utf-8",
            async: true,
           // url: feedSource + '/stats/allTimeLeaders.js',
			url : 'https://ipl-stats-sports-mechanic.s3.ap-south-1.amazonaws.com/ipl/feeds/stats/allTimeLeaders.js',
            dataType: "jsonp",
            jsonpCallback: 'onAllTimeLeaders',
            success: function (data) {
                callback(data);
            }
        });
    }
	
	var GetMVPPlayers = function (pSeason,callback) {
		var url = feedSource + '/stats/'+pSeason+'-mvpPlayersList.js';
		/*if(pSeason == 2024)
			url = feedSource + '/stats/mvpPlayersList.js';*/
        $.ajax({
            crossDomain: true,
            type: "GET",
            contentType: "application/json; charset=utf-8",
            async: true,
            url: url,
            dataType: "jsonp",
            jsonpCallback: 'onMvp',
            success: function (data) {
                callback(data);
            }
        });
    }
	
	var GetFairPlayList = function (pSeason,callback) {
		var url = feedSource + '/stats/'+pSeason+'-fairplayList.js';
		/*if(pSeason == 2024)
			url = feedSource + '/stats/fairplayList.js';*/
        $.ajax({
            crossDomain: true,
            type: "GET",
            contentType: "application/json; charset=utf-8",
            async: true,
            url: url,
            dataType: "jsonp",
            jsonpCallback: 'onFairplayAward',
            success: function (data) {
                callback(data);
            }
        });
    }
	var GetAllPlayerCareerStats = function (callback) {
		var url = feedSource + '/stats/player/allPlayerCarrierStats.js';
		
        $.ajax({
            crossDomain: true,
            type: "GET",
            contentType: "application/json; charset=utf-8",
            async: true,
            url: url,
            dataType: "jsonp",
            jsonpCallback: 'onIPLAllPlayerCarrierStats',
            success: function (data) {
                callback(data);
            }
        });
    }
	
	
	

    

	return {
        'GetMatchSchedule': GetMatchSchedule,
        'GetStandings':GetStandings,
        'GetTournamentList':GetTournamentList,
        'GetTeamList':GetTeamList,
        'GetPlayerStats':GetPlayerStats,
        'GetMatchSummary':GetMatchSummary,
        'GetScoringJs':GetScoringJs,
        'GetTourKeyPerformer':GetTourKeyPerformer,
        'GetTourStats':GetTourStats,
        'GetTourBattingStats':GetTourBattingStats,
		'GetTourBattingStatsV2' : GetTourBattingStatsV2,
        'GetTourBowlingStats':GetTourBowlingStats,
        'GetPlayerInningsWiseStats':GetPlayerInningsWiseStats,
        'GetMomentum':GetMomentum,
        'GetScorePotential':GetScorePotential,
        'GetWLProbability':GetWLProbability,
        'GetWC' : GetWC,
        'GetSA' : GetSA,
		'GetSuperOverMatchSummary' : GetSuperOverMatchSummary,
		'GetSquad':GetSquad,
		'getoverallStats':getoverallStats,
		'getPhotosVideos' : getPhotosVideos,
		'GetTeamSquads' : GetTeamSquads,
		'GetPlayerProfileBattingStats' : GetPlayerProfileBattingStats,
		'GetPlayerProfileBowlingStats' : GetPlayerProfileBowlingStats,
		'getScoreCardData' :getScoreCardData,
		'getMatches' : getMatches,
		'GetKPIInfo' : GetKPIInfo,
		'GetFixtureSquad' : GetFixtureSquad,
		'GetHeadtoHead' :GetHeadtoHead,
		'GettopScorer' :GettopScorer,
		'Gettopwicketers' : Gettopwicketers,
		'GetMediaList' : GetMediaList,
		'GetCompetitionSquads' : GetCompetitionSquads,
		'getPhotosList' : getPhotosList,
		'getMatchNotes' : getMatchNotes,
		'GetAllTimeLeaders' : GetAllTimeLeaders,
		'GetMVPPlayers' : GetMVPPlayers,
		'GetFairPlayList' : GetFairPlayList,
		'GetAllPlayerCareerStats' : GetAllPlayerCareerStats
    };
	
}]);



angular.module('MyApp').directive('smlivescorecard', ['$parse', '$document', '$compile', function ($parse, $document, $compile) {
    return {
        restrict: 'AEC',
      //  templateUrl: 'matchcentre-template.html',
       templateUrl: 'livescores',
        link: function ($scope, $elem, $attrs, $ctrl) {
			var servicetype = $attrs.servicetype;
			CricketSMIPLMC = true;
			liveShortWidget = false;
			liveBriefWidget = false;
			if(servicetype == undefined || servicetype == '')
				servicetype = 'all';
			var widgettype = $attrs.widgettype;
			var showwidget = $attrs.showwidget;
			if(showwidget == undefined || showwidget == '')
				showwidget = 'scorecard';
			
			competitionFeedPath="https://ipl-stats-sports-mechanic.s3.ap-south-1.amazonaws.com/ipl/mc/competition.js";
			if(widgettype == 'international'){
				competitionFeedPath="https://ipl-stats-sports-mechanic.s3.ap-south-1.amazonaws.com/ipl/mc/competition.js";
				feedSource = "https://scores.iplt20.com/ipl/feeds";
				basePath='https://scores.iplt20.com/ipl/';
				fullScorecardBasePath = "https://www.iplt20.com/";
			}
			var pathname = window.location.pathname; 
			pathname = pathname.split("/");
			var pathSplitLen = pathname.length;
			var cIdParm = (pathname[pathSplitLen-2] != undefined ) ? pathname[pathSplitLen-2] : '';
			
			
			var cIdParm = (pathname[pathSplitLen-5] != undefined ) ? pathname[pathSplitLen-5] : '';
			var matchParm = (pathname[pathSplitLen-2] != undefined && pathname[pathSplitLen-2] == 'match') ? 'match' : ((pathname[pathSplitLen-3] != undefined && pathname[pathSplitLen-3] == 'match') ? 'match' : '');
			
			var pCompetitionName = pathname[pathSplitLen-3];
			var pSeasonName = pCompetitionName.split("-");
			pSeasonName = pSeasonName[pSeasonName.length-2];
			
			
			var pCompetitionName = pathname[pathSplitLen-2];
			var pCompetitionName = pCompetitionName.split("-");
			pCompetitionName = pCompetitionName[0];
			
			if(pCompetitionName == 'women'){
				competitionFeedPath="https://scores.iplt20.com/ipl/mc/womenscompetition.js";
			}
			
			if( servicetype== 'fixtures')
			{
				
				$scope.init('fixtures','fixture','init',showwidget);
			}
				
			else if( servicetype== 'results')
				$scope.init('fixtures','result','init',showwidget);	
			else if( servicetype== 'live')
				$scope.init('fixtures','live','init',showwidget);	
			else if( servicetype== 'tstats'){
				$scope.init('tourstats','tourstats','init',showwidget);	
				var listenDiv = setInterval(function(){
					if($(".mcYearArch li").length > 0)
					{
						clearInterval(listenDiv);
						$(".mcYearArch li:first-child").addClass("active");
					}

				},1000);
				$(".mcYearArch li:first-child").addClass("active");
			}
			else if( servicetype== 'playerstats')
				$scope.init('teamstats','tourstats','init',showwidget);	
			else if( servicetype== 'teamstats')
				$scope.init('teamDetailStats','tourstats','init',showwidget);	
			else if( servicetype== 'standings')
				$scope.init('standings','standings','init',showwidget);
			else if( servicetype== 'all')
				$scope.init('fixtures','all','init',showwidget);	
			else
				$scope.constructScoreCard(servicetype,'');	
					
			$("#matchCenter").addClass("active");

			
        }
    };
} ]);


angular.module('MyApp').directive('smstandingswidget', ['$parse', '$document', '$compile', function ($parse, $document, $compile) {
    return {
        restrict: 'AEC',
       // templateUrl: 'standings-template.html',
       templateUrl: 'livescores',
        link: function ($scope, $elem, $attrs, $ctrl) {
			var servicetype = $attrs.servicetype;
			CricketSMIPLMC = true;
			liveShortWidget = false;
			liveBriefWidget = false;
			if(servicetype == undefined || servicetype == '')
				servicetype = 'all';
			var widgettype = $attrs.widgettype;
			var showwidget = $attrs.showwidget;
			if(showwidget == undefined || showwidget == '')
				showwidget = 'standings';
			if(widgettype == undefined || widgettype == '')
				widgettype = 'international';
			competitionFeedPath="https://ipl-stats-sports-mechanic.s3.ap-south-1.amazonaws.com/ipl/mc/competition.js";
			if(widgettype == 'international'){
				competitionFeedPath="https://ipl-stats-sports-mechanic.s3.ap-south-1.amazonaws.com/ipl/mc/competition.js";
				feedSource = "https://scores.iplt20.com/ipl/feeds";
				basePath='https://scores.iplt20.com/ipl/';
				fullScorecardBasePath = "https://www.iplt20.com/";
			}
			var pathname = window.location.pathname; 
			pathname = pathname.split("/");
			var pathSplitLen = pathname.length;
			var cIdParm = (pathname[pathSplitLen-2] != undefined ) ? pathname[pathSplitLen-2] : '';
			
			var cIdParm = (pathname[pathSplitLen-5] != undefined ) ? pathname[pathSplitLen-5] : '';
			var matchParm = (pathname[pathSplitLen-2] != undefined && pathname[pathSplitLen-2] == 'match') ? 'match' : ((pathname[pathSplitLen-3] != undefined && pathname[pathSplitLen-3] == 'match') ? 'match' : '');
			
			var pCompetitionName = pathname[pathSplitLen-3];
			var pSeasonName = pCompetitionName.split("-");
			pSeasonName = pSeasonName[pSeasonName.length-2];
			//pSeasonName = parseInt(pSeasonName);
			
			
			var pCompetitionName = pathname[pathSplitLen-2];
			var pCompetitionName = pCompetitionName.split("-");
			pCompetitionName = pCompetitionName[0];
			
			if(pCompetitionName == 'women'){
				competitionFeedPath="https://scores.iplt20.com/ipl/mc/womenscompetition.js";
			}
			
			if( servicetype== 'fixtures')
			{
				
				
				$scope.init('fixtures','fixture','init',showwidget);
			}
				
			else if( servicetype== 'results')
				$scope.init('fixtures','result','init',showwidget);	
			else if( servicetype== 'live')
				$scope.init('fixtures','live','init',showwidget);	
			else if( servicetype== 'tstats'){
				$scope.init('tourstats','tourstats','init',showwidget);	
				var listenDiv = setInterval(function(){
					if($(".mcYearArch li").length > 0)
					{
						clearInterval(listenDiv);
						$(".mcYearArch li:first-child").addClass("active");
					}

				},1000);
				$(".mcYearArch li:first-child").addClass("active");
			}
			else if( servicetype== 'playerstats')
				$scope.init('teamstats','tourstats','init',showwidget);	
			else if( servicetype== 'teamstats')
				$scope.init('teamDetailStats','tourstats','init',showwidget);	
			else if( servicetype== 'standings')
				$scope.init('standings','standings','init',showwidget);
			else if( servicetype== 'all')
				$scope.init('fixtures','all','init',showwidget);	
			else
				$scope.constructScoreCard(servicetype,'');	
					
			$("#matchCenter").addClass("active");

			
        }
    };
} ]);

angular.module('MyApp').directive('smstatswidget', ['$parse', '$document', '$compile', function ($parse, $document, $compile) {
    return {
        restrict: 'AEC',
      //  templateUrl: 'stats-template.html',
       templateUrl: 'livescores',
        link: function ($scope, $elem, $attrs, $ctrl) {
			var servicetype = $attrs.servicetype;
			CricketSMIPLMC = true;
			liveShortWidget = false;
			liveBriefWidget = false;
			if(servicetype == undefined || servicetype == '')
				servicetype = 'tstats';
			var widgettype = $attrs.widgettype;
			var showwidget = $attrs.showwidget;
			if(showwidget == undefined || showwidget == '')
				showwidget = 'tstats';
			if(widgettype == undefined || widgettype == '')
				widgettype = 'international';
			competitionFeedPath="https://ipl-stats-sports-mechanic.s3.ap-south-1.amazonaws.com/ipl/mc/competition.js";
			if(widgettype == 'international'){
				competitionFeedPath="https://ipl-stats-sports-mechanic.s3.ap-south-1.amazonaws.com/ipl/mc/competition.js";
				feedSource = "https://scores.iplt20.com/ipl/feeds";
				basePath='https://scores.iplt20.com/ipl/';
				fullScorecardBasePath = "https://www.iplt20.com/";
			}
			var pathname = window.location.pathname; 
			pathname = pathname.split("/");
			var pathSplitLen = pathname.length;
			var cIdParm = (pathname[pathSplitLen-2] != undefined ) ? pathname[pathSplitLen-2] : '';
			
			
			var cIdParm = (pathname[pathSplitLen-5] != undefined ) ? pathname[pathSplitLen-5] : '';
			var matchParm = (pathname[pathSplitLen-2] != undefined && pathname[pathSplitLen-2] == 'match') ? 'match' : ((pathname[pathSplitLen-3] != undefined && pathname[pathSplitLen-3] == 'match') ? 'match' : '');
			
			var pCompetitionName = pathname[pathSplitLen-3];
			var pSeasonName = pCompetitionName.split("-");
			pSeasonName = pSeasonName[pSeasonName.length-2];
			//pSeasonName = parseInt(pSeasonName);
			console.log(pSeasonName);
			pCompetitionName = $scope.nameConvertForURL(pCompetitionName);
			
			if( servicetype== 'fixtures')
			{
				
				$scope.init('fixtures','fixture','init',showwidget);
			}
				
			else if( servicetype== 'results')
				$scope.init('fixtures','result','init',showwidget);	
			else if( servicetype== 'live')
				$scope.init('fixtures','live','init',showwidget);	
			else if( servicetype== 'tstats'){
				$scope.init('tourstats','tourstats','init',showwidget);	
				var listenDiv = setInterval(function(){
					if($(".mcYearArch li").length > 0)
					{
						clearInterval(listenDiv);
						$(".mcYearArch li:first-child").addClass("active");
					}

				},1000);
				$(".mcYearArch li:first-child").addClass("active");
			}
			else if( servicetype== 'playerstats')
				$scope.init('teamstats','tourstats','init',showwidget);	
			else if( servicetype== 'teamstats')
				$scope.init('teamDetailStats','tourstats','init',showwidget);	
			else if( servicetype== 'standings')
				$scope.init('standings','standings','init',showwidget);
			else if( servicetype== 'all')
				$scope.init('fixtures','all','init',showwidget);	
			else
				$scope.constructScoreCard(servicetype,'');	
					
			$("#matchCenter").addClass("active");

			
        }
    };
} ]);

function MatchSchedule(data){
	matchScheduleResponse = data;
}

function ongroupstandings(data){
	grpStandingsResponse = data;
}

function onTournamentstats(data){
	tourstatsResponse = data;
}

function onteamlist(data){
	teamListResponse = data;
}

function onsquad(data){
	teamSquadsResponse = data;
}

function onScoring(data){
	innScoreResponse = data;
}

function onMomentum(data){
	momentumResponse = data;
}

function onScorePotentials(data){
	SPResponse = data;
}

function onsuperovermatchsummary(data)
{
	superovermatchsummaryResponse = data;
}
function onsquadFixture(data){
	fixtureSquadResponse = data;
}
function onCompetitionSquad(data){
	CompetitionSquadResponse = data;
}
function onMatchHTH(data){
	expertHTHResponse = data;
}

function ontoprunsscorers(data){
	GetTopscorerResponse = data;
}
function onmostwickets(data){
	GetMostWicketersResponse = data;
}
