import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils, VRMExpression, VRMExpressionMorphTargetBind } from '@pixiv/three-vrm';
import { createVRMAnimationClip, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';

export { THREE, GLTFLoader, OrbitControls, VRMLoaderPlugin, VRMUtils,
  VRMExpression, VRMExpressionMorphTargetBind, createVRMAnimationClip,
  VRMAnimationLoaderPlugin };
