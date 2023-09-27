function isAdminUser() {
    return true;
}

const KEY_USERNAME = 'dscc.username';
const KEY_PASSWORD = 'dscc.password';

/**
 * Returns true if the auth service has access.
 * @return {boolean} True if the auth service has access.
 */
function isAuthValid() {
    const {username, password} = getCredentials();
    return checkAuth(username, password);
}

function checkAuth(userName, password) {
    return (userName ?? '') !== '' && (password ?? '') !== '';
}

/**
 * Resets the auth service.
 */
function resetAuth() {
    PropertiesService.getUserProperties().deleteProperty(KEY_USERNAME);
    PropertiesService.getUserProperties().deleteProperty(KEY_PASSWORD);
}

function getAuthType() {
    var cc = DataStudioApp.createCommunityConnector();
    return cc
        .newAuthTypeResponse()
        .setAuthType(cc.AuthType.USER_PASS)
        .build();
}

/**
 * Sets the credentials.
 * @param {Request} request The set credentials request.
 * @return {object} An object with an errorCode.
 */
function setCredentials(request) {
    const {username, password} = request.userPass;
    if (!checkAuth(username, password)) {
        return {
            errorCode: 'INVALID_CREDENTIALS'
        };
    }

    const userProperties = PropertiesService.getUserProperties();
    userProperties.setProperty(KEY_USERNAME, username);
    userProperties.setProperty(KEY_PASSWORD, password);
    return {
        errorCode: 'NONE'
    };
}

function getCredentials() {
    const username = PropertiesService.getUserProperties().getProperty(KEY_USERNAME);
    Logger.log(`username: ${username}`);
    const password = PropertiesService.getUserProperties().getProperty(KEY_PASSWORD);
    return {
        username,
        password
    };
}

function getReqOptions() {
    const {username, password} = getCredentials();

    return {
        'method': 'get',
        "headers": {"Authorization": "Basic " + Utilities.base64Encode(`${username}:${password}`)},
        "muteHttpExceptions": true
    };
}

function getConfig(request) {
    var cc = DataStudioApp.createCommunityConnector();
    var config = cc.getConfig();

    config.newInfo()
        .setId('instructions')
        .setText('ホスト名を教えてください。https://XXX.questetra.net の XXX 部分。');

    config.newTextInput()
        .setId('host')
        .setName('ホスト名');

    config.newTextInput()
        .setId('processModelInfoId')
        .setName('アプリ ID');

    config.setDateRangeRequired(true);

    return config.build();
}

function getDefinitions(request) {
    const {
        configParams: {
            host,
            processModelInfoId
        }
    } = request;
    const options = getReqOptions();
    const url = [
        'https://',
        host,
        '.questetra.net',
        '/API/OR/ProcessDataDefinition/list',
        '?processModelInfoId=',
        processModelInfoId
    ].join('');
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    if (code !== 200) {
        resetAuth();
        const error = `failed to get defs: status: ${code}`;
        throw new Error(error);
    }
    return JSON.parse(response.getContentText()).definitions;
}

function getFields(request) {
    var cc = DataStudioApp.createCommunityConnector();
    var fields = cc.getFields();
    var types = cc.FieldType;

    fields.newDimension()
        .setId('processInstanceId')
        .setName('プロセス ID')
        .setType(types.NUMBER);

    fields.newDimension()
        .setId('processInstanceTitle')
        .setName('件名')
        .setType(types.TEXT);

    fields.newDimension()
        .setId('processInstanceInitQuserId')
        .setName('プロセス開始ユーザ ID')
        .setType(types.NUMBER);

    fields.newDimension()
        .setId('processInstanceInitQuserName')
        .setName('プロセス開始ユーザ名')
        .setType(types.TEXT);

    fields.newDimension()
        .setId('processInstanceInitQgroupId')
        .setName('プロセス開始組織 ID')
        .setType(types.NUMBER);

    fields.newDimension()
        .setId('processInstanceInitQgroupName')
        .setName('プロセス開始組織名')
        .setType(types.TEXT);

    fields.newDimension()
        .setId('processInstanceStartDatetime')
        .setName('プロセス開始日時')
        .setType(types.YEAR_MONTH_DAY_SECOND);

    fields.newDimension()
        .setId('processInstanceEndDatetime')
        .setName('プロセス終了日時')
        .setType(types.YEAR_MONTH_DAY_SECOND);

    const defs = getDefinitions(request);
    defs.forEach(def => {
        const fieldId = `data_${def.dataType}_${def.processDataDefinitionNumber}`;
        const fieldName = def.name;
        switch (def.dataType) {
            case 'STRING':
            case 'QUSER':
            case 'QGROUP':
                fields.newDimension()
                    .setId(fieldId)
                    .setName(fieldName)
                    .setType(types.TEXT);
                break;
            case 'DATE':
                switch (def.subType) {
                    case 'DATE_YMD':
                        fields.newDimension()
                            .setId(fieldId)
                            .setName(fieldName)
                            .setType(types.YEAR_MONTH_DAY);
                }
                break;
            case 'DATETIME':
                fields.newDimension()
                    .setId(fieldId)
                    .setName(fieldName)
                    .setType(types.YEAR_MONTH_DAY_SECOND);
                break;
        }
    });

    return fields;
}

function fieldIdToDataNumber(fieldId) {
    const segments = fieldId.split('_');
    return {
        type: segments[1],
        number: parseInt(segments[2])
    };
}

function getSchema(request) {
    var fields = getFields(request).build();
    return {schema: fields};
}

function getProcessInstances(request, criteriaObj, start, limit) {
    const {
        configParams: {
            host
        }
    } = request;
    const options = getReqOptions();

    const url = [
        'https://',
        host,
        '.questetra.net',
        '/API/OR/ProcessInstance/list',
        '?criteria=',
        encodeURIComponent(JSON.stringify(criteriaObj)),
        '&start=',
        start,
        '&limit=',
        limit
    ].join('');
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    if (code !== 200) {
        resetAuth();
        const error = `failed to get defs: status: ${code}`;
        throw new Error(error);
    }
    const {
        count,
        processInstances
    } = JSON.parse(response.getContentText());
    Logger.log(`count: ${count} logsCount: ${processInstances.length}`);

    return {
        count,
        processInstances
    };
}

function getData(request) {
    Logger.log(request.fields);
    const requestedFieldIds = request.fields.map(function (field) {
        return field.name;
    });
    const requestedFields = getFields(request).forIds(requestedFieldIds);
    const dataFields = requestedFields.asArray()
        .map(field => field.getId())
        .filter(fieldId => fieldId.startsWith('data_'))
        .map(fieldId => {
            const {type, number} = fieldIdToDataNumber(fieldId);
            return {
                type: type.toLowerCase(),
                number
            };
        });
    const {
        configParams: {
            processModelInfoId
        },
        dateRange: {
            startDate,
            endDate
        }
    } = request;

    const LIMIT = 1000;
    let rows = [];
    const criteria = {
        processModelInfoId,
        processInstanceEndDateFrom: startDate,
        processInstanceEndDateTo: endDate,
        fields: dataFields
    };
    for (let i = 0; ; i += LIMIT) {
        const {count, processInstances} = getProcessInstances(request, criteria, i, LIMIT);

        rows = rows.concat(responseToRows(requestedFields, processInstances));
        if (i + LIMIT >= count) {
            break;
        }
    }

    Logger.log(`total count: ${rows.length}`);
    return {
        schema: requestedFields.build(),
        rows
    };
}

function responseToRows(requestedFields, processInstances) {
    return processInstances.map(function (pi) {
        const row = [];
        requestedFields.asArray().forEach(function (field) {
            const fieldId = field.getId();
            let fieldValue;
            if (fieldId.startsWith('data_')) {
                const {number} = fieldIdToDataNumber(fieldId);
                fieldValue = pi.data[String(number)].value;
            } else {
                fieldValue = pi[fieldId];
            }
            switch (field.getType().toString()) {
                case 'YEAR_MONTH_DAY_SECOND':
                    fieldValue = fieldValue.slice(0, 19).replace(/-|:|T/g, '');
                    break;
                case 'YEAR_MONTH_DAY':
                    fieldValue = fieldValue.replace(/-/g, '');
                    break;
            }
            //Logger.log(`fieldId: ${fieldId} type: ${field.getType()} value: ${fieldValue}`);
            row.push(fieldValue);
        });
        return {values: row};
    });
}