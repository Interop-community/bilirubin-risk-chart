'use strict';

angular.module('bilirubinApp.controllers', []).controller('bilirubinCtrl', ['$scope', '$risk','$filter', function ($scope, $risk, $filter ) {
    $scope.patient = {
        name: ''
    };
    $scope.name = '';

    $scope.hours = function (observation, dob) {
        var hours = (new Date(observation).getTime() - new Date(dob).getTime()) / 36e5;
        return (hours > 1000 || hours < -1000) ? "-----" : hours;
    };

    $scope.obsDate = $filter('date')(new Date(), 'MM/dd/yyyy HH:mm');
    $scope.obsDateIsValid = false;
    $scope.obsValue = 0;
    $scope.obsValueIsValid = false;
    $scope.isSaveDisabled = true;
    $scope.isReadOnly = true;
    $scope.enterObsVisible = false;

    var newPoint = [];
    var lastPoint = [];
    var bilirubin = [];

    $scope.$watchGroup(['obsValue', 'obsDate'], function() {
        $scope.obsValueIsValid = (!isNaN($scope.obsValue) && $scope.obsValue > 0 && $scope.obsValue <= 25);
        $scope.obsDateIsValid = validateNewDate($scope.obsDate);
        if ($scope.obsValueIsValid && $scope.obsDateIsValid) {
            $scope.isSaveDisabled = false;
            if (newPoint.length == 0 && lastPoint.length > 0)
                newPoint.push(lastPoint[0]);
            if (newPoint.length > 1)
                newPoint.pop();
            newPoint.push([$scope.hours($scope.obsDate, $scope.patient.dob), parseFloat($scope.obsValue)]);
        }
    });

    $scope.toggleObsVisible = function() {
        $scope.enterObsVisible = !$scope.enterObsVisible;
    };

    $scope.risk = function (bilirubinResult, ageInHours) {
        if ((bilirubinResult > 20))
            return 'Critical Risk Zone';
        else if (bilirubinResult >= $risk.highRiskLowerLimit(ageInHours))
            return 'High Risk Zone (>95%)';
        else if (bilirubinResult >= $risk.highIntermediateLowerLimit(ageInHours))
            return 'High Intermediate Risk Zone (75-95%)';
        else if (bilirubinResult >= $risk.lowIntermediateLowerLimit(ageInHours))
            return 'Low Intermediate Risk Zone (40-74%)';
        else
            return 'Low Risk Zone (<40%)';
    };

    var criticalRiskZone = [];
    for (var int = 0; int <= 120; int++)
        criticalRiskZone.push([int, 20, 25]);
    var highRiskZone = [];
    for (var int = 0; int <= 120; int++)
        highRiskZone.push([int, $risk.highRiskLowerLimit(int), 20]);
    var highIntermediateRiskZone = [];
    for (var int = 0; int <= 120; int++)
        highIntermediateRiskZone.push([int, $risk.highIntermediateLowerLimit(int), $risk.highRiskLowerLimit(int)]);
    var lowIntermediateRiskZone = [];
    for (var int = 0; int <= 120; int++)
        lowIntermediateRiskZone.push([int, $risk.lowIntermediateLowerLimit(int), $risk.highIntermediateLowerLimit(int)]);
    var lowRiskZone = [];
    for (var int = 0; int <= 120; int++)
        lowRiskZone.push([int, 0, $risk.lowIntermediateLowerLimit(int)]);

    function validateNewDate(date) {
        var newDate = new Date(date);
        if ( isNaN(newDate.getTime()))
            return false;

        var ageHours = $scope.hours(newDate, $scope.patient.dob);
        return (0 <= ageHours && ageHours <=120)
    }

    $scope.saveObs = function(obsDate, obsValue) {

        if (!validateNewDate(obsDate, $scope.patient.dob))
         return;

        var newObs = formatObservation('{ \
            "resourceType" : "Observation",\
            "code" :\
            {\
                "coding" :\
                    [\
                        {\
                            "system" : "http://loinc.org",\
                            "code" : "58941-6",\
                            "display" : "Transcutaneous Bilirubin"\
                        }\
                    ]\
            },\
            "valueQuantity" :\
            {\
                "value" : {0},\
                "unit" : "mg/dL",\
                "code" : "mg/dL"\
            },\
            "effectiveDateTime" : "{1}",\
            "status" : "final",\
            "subject" :\
            {\
                "reference" : "Patient/{2}"\
            }\
        }',obsValue, new Date(obsDate).toISOString(), $scope.patient.id);

        $scope.smart.api.create({type: "Observation", data: newObs})
            .done(function(){
                queryBilirubinData($scope.smart);
            }).fail(function(){
                console.log("failed to create observation", arguments);
            });
    };

    function formatObservation(format) {
        var args = Array.prototype.slice.call(arguments, 1);
        return format.replace(/{(\d+)}/g, function(match, number) {
            return typeof args[number] != 'undefined'
                ? args[number]
                : match
                ;
        });
    }

    function hasWriteScope(smart){
        var scope = smart.tokenResponse.scope;
        var scopes = scope.split(" ");

        angular.forEach(scopes, function (value) {
            if (value === "patient/*.*" || value === "patient/*.write"){
                $scope.isReadOnly = false;
            }
        });
    }

    function queryPatient(smart){
        $.when(smart.patient.read())
            .done(function(patient){
                angular.forEach(patient.name[0].given, function (value) {
                    $scope.patient.name = $scope.patient.name + ' ' + String(value);
                });
                angular.forEach(patient.name[0].family, function (value) {
                    $scope.patient.name = $scope.patient.name + ' ' + value;
                });
                $scope.patient.sex = patient.gender;
                $scope.patient.dob = patient.birthDate;
                $scope.patient.id  = patient.id;
            });
    }

    function queryBilirubinData(smart) {
        var deferred = $.Deferred();

        $.when(smart.patient.api.search({type: "Observation", query: {code: '58941-6'}, count: 50}))
            .done(function(obsSearchResult){
                var observations = [];
                if (obsSearchResult.data.entry) {
                    obsSearchResult.data.entry.forEach(function(obs){
                        observations.push(obs.resource);
                    });
                }
                if(observations){
                    $scope.values = $filter('orderBy')(observations,"effectiveDateTime");
                }
                while (bilirubin.length > 0) {
                    bilirubin.pop();
                }
                angular.forEach($scope.values, function (value) {
                    if(validateNewDate(value.effectiveDateTime)) {
                        bilirubin.push([$scope.hours(value.effectiveDateTime, $scope.patient.dob), parseFloat(value.valueQuantity.value)]);
                    }
                });
                while (lastPoint.length > 0) {
                    lastPoint.pop();
                }
                if (bilirubin.length > 0) {
                    lastPoint.push(bilirubin[bilirubin.length - 1]);
                }

                while (newPoint.length > 0) {
                    newPoint.pop();
                }
                $scope.$apply();
                deferred.resolve();
            });
        return deferred;
    }

    FHIR.oauth2.ready(function(smart){
        $scope.smart = smart;
        hasWriteScope(smart);
        queryPatient(smart);
        queryBilirubinData(smart)
            .done(function(){

            $scope.chartConfig = {
                options: {
                    tooltip: {
                        crosshairs: true,
                        valueDecimals: 2,
                        headerFormat: '<span style="font-size: 10px">{point.key:.2f}</span><br/>'
                    },
                    legend: {
                        enabled: false
                    }
                },
                xAxis: {
                    minPadding: 0,
                    maxPadding: 0,
                    gridLineWidth: 1,
                    tickInterval: 24,
                    title: {
                        text: 'Postnatal Age (hours)'
                    }
                },
                yAxis: {
                    minPadding: 0,
                    maxPadding: 0,
                    title: {
                        text: 'Serum Bilirubin (mg/dl)'
                    },
                    plotLines: [
                        {
                            value: 24,
                            color: 'transparent',
                            width: 1,
                            label: {
                                text: 'Critical Risk Zone',
                                align: 'center',
                                style: {
                                    color: 'black'
                                }
                            }
                        },
                        {
                            value: 19,
                            color: 'transparent',
                            width: 1,
                            label: {
                                text: 'High Risk Zone (>95%)',
                                align: 'center',
                                style: {
                                    color: 'black'
                                }
                            }
                        },
                        {
                            value: 13,
                            color: 'transparent',
                            width: 1,
                            label: {
                                text: 'High Intermediate Risk Zone (75-95%)',
                                align: 'center',
                                rotation: -25,
                                style: {
                                    color: 'black'
                                }
                            }
                        },
                        {
                            value: 10.75,
                            color: 'transparent',
                            width: 1,
                            label: {
                                text: 'Low Intermediate Risk Zone (40-74%)',
                                align: 'center',
                                rotation: -20,
                                style: {
                                    color: 'black'
                                }
                            }
                        },
                        {
                            value: 0.5,
                            color: 'transparent',
                            width: 1,
                            label: {
                                text: 'Low Risk Zone',
                                align: 'center',
                                style: {
                                    color: 'black'
                                }
                            }
                        }
                    ]
                },
                plotOptions: {
                    series: {
                        fillOpacity: 0.35
                    }
                },
                series: [
                    {
                        name: 'Critical Risk Zone',
                        data: criticalRiskZone,
                        color: '#FF0000',
                        type: 'arearange'
                    },
                    {
                        name: 'High Risk Zone (>95%)',
                        data: highRiskZone,
                        color: '#FF8040',
                        type: 'arearange'
                    },
                    {
                        name: 'High Intermediate Risk Zone (75-95%)',
                        data: highIntermediateRiskZone,
                        color: '#FFFF00',
                        type: 'arearange'
                    },
                    {
                        name: 'Low Intermediate Risk Zone (40-74%)',
                        data: lowIntermediateRiskZone,
                        color: '#00FF00',
                        type: 'arearange'
                    },
                    {
                        name: 'Low Risk Zone (<40%)',
                        data: lowRiskZone,
                        color: '#f7f7f7',
                        type: 'arearange'
                    },
                    {
                        name: 'New Bilirubin Result',
                        data: newPoint,
                        type: 'line',
                        color: '#9a9a9a',
                        dashStyle: 'dash',
                        marker: {
                            lineWidth: 2,
                            symbol: 'circle',
                            radius: 3,
                            lineColor: null
                        }
                    },
                    {
                        name: 'Bilirubin',
                        data: bilirubin,
                        color: '#0077FF',
                        type: 'line'
                    }
                ],
                title: {
                    text: 'Hour Specific Bilirubin Risk Chart for Term & Near-Term Infants with NO Additional Risk Factors'
                },
                credits: {
                    enabled: false
                }
            };
        $scope.$digest();
      });
    });
}]);