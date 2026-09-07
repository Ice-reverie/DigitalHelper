# -*- coding: gbk -*-
import importlib.util, sys
sys.path.insert(0, r'D:\DigitalHelper')

py = open('vrm_demo/vrm_server.py', 'rb').read().decode('utf-8-sig')
js = open('vrm_demo/static/js/VRMCharacter.js', 'rb').read().decode('utf-8-sig')

checks = [
    ('backend ACTION_RULES', 'ACTION_RULES' in py),
    ('backend match_action', 'def match_action' in py),
    ('backend return action', '"action": action' in py),
    ('frontend playActionByName fn', 'function playActionByName(name)' in py and 'playActionByName' in js),
    ('frontend trigger', 'if (data.action) playActionByName(data.action);' in js),
    ('frontend animations path', "animations/' + name + '.vrma'" in js),
]
for name, ok in checks:
    print(('OK   ' if ok else 'MISS ') + name)

from vrm_demo.vrm_server import match_action, app
print('match_action("你好") ->', match_action('你好'))
print('match_action("帮我预约挂号") ->', match_action('帮我预约挂号'))
print('match_action("随便") ->', match_action('随便'))
print('IMPORT_OK')